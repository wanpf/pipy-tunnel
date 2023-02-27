((
  { config } = pipy.solve('config.js'),

  {
    isDebugEnabled,
    slotCount,
    slotArray,
    listIssuingCA,
    tunnelServers,
    fullTargetStructs,
    serverTargetStructs,
    unhealthyTargetCache,
    unhealthyTargetTTLCache,
    loadBalancers,
  } = pipy.solve('tunnel-init.js'),

  probeIndex = 0,
  pingFailures = {},
  accessFailures = {},
  unhealthyServers = new Set(),
  unhealthyTargets = new Set(),

  pipyTunnelHealthyGauge = new stats.Gauge('pipy_tunnel_healthy', ['tunnelName']),
  pipyTunnelTargetHealthyGauge = new stats.Gauge('pipy_tunnel_target_healthy', ['tunnelName', 'target']),
  pipyActiveConnectionGauge = new stats.Gauge('pipy_active_connection', ['serviceId', 'tunnelName', 'target']),
  pipyTotalConnectionCounter = new stats.Counter('pipy_total_connection', ['serviceId', 'tunnelName', 'target']),
  pipyTunnelActiveConnectionGauge = new stats.Gauge('pipy_tunnel_active_connection', ['serviceId', 'tunnelName', 'target']),
  pipyTunnelTotalConnectionCounter = new stats.Counter('pipy_tunnel_total_connection', ['serviceId', 'tunnelName', 'target']),
  pipySendTargetBytesTotalCounter = new stats.Counter('pipy_send_target_bytes_total', ['serviceId', 'tunnelName', 'target']),
  pipyReceiveTargetBytesTotalCounter = new stats.Counter('pipy_receive_target_bytes_total', ['serviceId', 'tunnelName', 'target']),
  pipySendTunnelBytesTotalCounter = new stats.Counter('pipy_send_tunnel_bytes_total', ['serviceId', 'tunnelName', 'target']),
  pipyReceiveTunnelBytesTotalCounter = new stats.Counter('pipy_receive_tunnel_bytes_total', ['serviceId', 'tunnelName', 'target']),

  setTunnelHealthy = (target, status) => (
    pipyTunnelHealthyGauge.withLabels(tunnelServers[target]?.name).set(status)
  ),

  setTargetHealthy = (key, status) => (
    key && (
      (items = key.split('@')) => (
        pipyTunnelTargetHealthyGauge.withLabels(tunnelServers[items[1]]?.name, items[0]).set(status)
      )
    )()
  ),

) => pipy({
  _reqSize: 0,
  _resSize: 0,
  _reqRawSize: 0,
  _resRawSize: 0,
  _path: undefined,
  _target: undefined,
  _backend: undefined,
  _tunnel: undefined,
  _balancer: undefined,
  _serviceId: undefined,
  _loadBalancerAddr: undefined,
  _skipTask: true,
  _probeCounter: undefined,
  _probeResult: undefined,
  _bpsLimit: -1,
})

.pipeline('startup')
.handleStreamStart(
  () => (
    _loadBalancerAddr = `${__inbound.localAddress}:${__inbound.localPort}`,
    (_serviceId = config.loadBalancers[_loadBalancerAddr]?.serviceId) || (
      _loadBalancerAddr = __inbound.localPort,
      _serviceId = config.loadBalancers[_loadBalancerAddr]?.serviceId
    ),
    _serviceId && (
      _bpsLimit = config.loadBalancers[_loadBalancerAddr]?.bpsLimit,
      _balancer = loadBalancers[_loadBalancerAddr],
      _target = _balancer?.next?.(
        __inbound, (config.loadBalancers[_loadBalancerAddr]?.sticky ? __inbound.remoteAddress : null), unhealthyTargetTTLCache),
      _target?.id && (_backend = fullTargetStructs[_target.id]) && (
        pipyActiveConnectionGauge.withLabels(_serviceId, _backend.server.name, _backend.path).increase(),
        pipyTotalConnectionCounter.withLabels(_serviceId, _backend.server.name, _backend.path).increase()
      )
    )
  )
)
.branch(
  () => _bpsLimit > 0, (
    $=>$.throttleDataRate(
      () => (
        new algo.Quota(
          _bpsLimit,
          {
            produce: _bpsLimit,
            per: '1s',
          }
        )
      )
    )
  ), (
    $=>$
  )
)
.branch(
  isDebugEnabled, (
    $=>$.handleStreamStart(
      () => (
        console.log(`[*New tunnel*]' __thread.id: ${__thread.id}, LB: ${_loadBalancerAddr}, server: ${_backend?.server?.target}, target: ${_backend?.path}`)
      )
    )
  )
)
.branch(
  () => !Boolean(_backend), (
    $=>$.replaceStreamStart(
      () => new StreamEnd('ConnectionReset')
    )
  ),
  (
    $=>$.link('pass')
  )
)
.branch(
  () => _bpsLimit > 0, (
    $=>$.throttleDataRate(
      () => (
        new algo.Quota(
          _bpsLimit,
          {
            produce: _bpsLimit,
            per: '1s',
          }
        )
      )
    )
  ), (
    $=>$
  )
)
.handleStreamEnd(
  () => _backend && (
    pipyActiveConnectionGauge.withLabels(_serviceId, _backend.server.name, _backend.path).decrease()
  )
)

.pipeline('pass')
.handleData(
  data => (
    _reqRawSize += data.size,
    pipySendTargetBytesTotalCounter.withLabels(_serviceId, _backend.server.name, _backend.path).increase(data.size)
  )
)
.connectHTTPTunnel(
  () => new Message({
    method: 'CONNECT',
    path: _backend.path,
  })
).to(
  $=>$.muxHTTP(() => _backend.server, { version: 2 }).to(
    $=>$.branch(
      () => _backend.server.tlsCert, (
        $=>$.connectTLS({
          certificate: () => ({
            cert: _backend.server.tlsCert,
            key: _backend.server.tlsKey,
          }),
          trusted: listIssuingCA,
        }).to($=>$.link('upstream'))
      ),
      (
        $=>$.link('upstream')
      )
    )
  )
)
.handleData(
  data => (
    _resRawSize += data.size,
    pipyReceiveTargetBytesTotalCounter.withLabels(_serviceId, _backend.server.name, _backend.path).increase(data.size)
  )
)
.handleStreamEnd(
  (e) => (
    (_reqRawSize > 0 && _resRawSize === 0) ? (
      accessFailures[_backend.key] = (accessFailures[_backend.key] | 0) + 1,
      isDebugEnabled && (
        console.log(`[*StreamEnd*] error: ${e.error}, target: ${_backend.key}, times: ${accessFailures[_backend.key]}`)
      ),
      (accessFailures[_backend.key] >= config.tunnel.healthcheck.target.failures) && (
        accessFailures[_backend.key] = config.tunnel.healthcheck.target.failures,
        unhealthyTargetTTLCache.set(_backend.key, true),
        setTargetHealthy(_backend.key, 0)
      )
    ) : delete accessFailures[_backend.key]
  )
)

.pipeline('upstream')
.handleStreamStart(
  () => (
    pipyTunnelActiveConnectionGauge.withLabels(_serviceId, _backend.server.name, _backend.path).increase(),
    pipyTunnelTotalConnectionCounter.withLabels(_serviceId, _backend.server.name, _backend.path).increase()
  )
)
.handleData(
  data => (
    _reqSize += data.size,
    pipySendTunnelBytesTotalCounter.withLabels(_serviceId, _backend.server.name, _backend.path).increase(data.size)
  )
)
.connect(() => _backend.server.target, { retryCount: config.tunnel.policies.connectRetry })
.handleData(
  data => (
    _resSize += data.size,
    pipyReceiveTunnelBytesTotalCounter.withLabels(_serviceId, _backend.server.name, _backend.path).increase(data.size)
  )
)
.handleStreamEnd(
  (e) => (
    (e.error === 'ConnectionRefused' || e.error === 'ConnectionTimeout') ? (
      (target = _backend.server.target) => (
        accessFailures[target] = (accessFailures[target] | 0) + 1,
        isDebugEnabled && (
          console.log(`[*StreamEnd*] error: ${e.error}, server: ${target}, times: ${accessFailures[target]}`)
        ),
        (accessFailures[target] >= config.tunnel.healthcheck.server.failures) && (
          accessFailures[target] = config.tunnel.healthcheck.server.failures,
          serverTargetStructs[target]?.forEach(
            t => (
              unhealthyTargetTTLCache.set(t, true),
              setTargetHealthy(t, 0)
            )
          )
        )
      )
    )() : delete accessFailures[_backend.server.target],
    pipyTunnelActiveConnectionGauge.withLabels(_serviceId, _backend.server.name, _backend.path).decrease()
  )
)

.pipeline('ping')
.replaceMessage(
  msg => (
    _probeResult = -1,
    _path = msg?.head?.path,
    _target = msg?.head?.target,
    _target ? (
      _tunnel = tunnelServers[_target],
      new Message({
        method: 'GET',
        path: _path,
        headers: { 'x-pipy-probe': 'PING' }
      })
    ) : new Message
  )
)
.branch(
  () => Boolean(_target), (
    $=>$.muxHTTP(() => _target, { version: 2 }).to(
      $=>$.branch(
        () => _tunnel?.tlsCert, (
          $=>$.connectTLS({
            certificate: () => ({
              cert: _tunnel.tlsCert,
              key: _tunnel.tlsKey,
            }),
            trusted: listIssuingCA,
          }).to(
            $=>$.connect(() => _target,
              {
                connectTimeout: config?.tunnel?.healthcheck.connectTimeout,
                readTimeout: config?.tunnel?.healthcheck.readTimeout
              }
            )
          )
        ),
        (
          $=>$.connect(() => _target,
            {
              connectTimeout: config?.tunnel?.healthcheck.connectTimeout,
              readTimeout: config?.tunnel?.healthcheck.readTimeout
            }
          )
        )
      )
    )
    .replaceMessage(
      msg => (
        msg?.head?.headers?.['x-pipy-probe'] === 'PONG' && (_probeResult = 1),
        msg?.head?.headers?.['x-pipy-probe'] === 'FAIL' && (_probeResult = 0),
        new StreamEnd
      )
    )
    .replaceStreamEnd(
      (e) => (
        (key = _path + '@' + _target) => (
          (e.error === 'ConnectionRefused' || e.error === 'ConnectionTimeout') && (
            _probeResult = -1
          ),
          (_probeResult === 1) ? (
            isDebugEnabled && (
              console.log(`[*ping OK*] server: ${_target}, target: ${_path}`)
            ),
            delete pingFailures[key],
            _path === '/' ? (
              unhealthyServers.delete(_target),
              setTunnelHealthy(_target, 1)
            ) : (
              unhealthyTargets.delete(key),
              setTargetHealthy(key, 1)
            )
          ) : (
            pingFailures[key] = (pingFailures[key] | 0) + 1,
            isDebugEnabled && (
              console.log(`[*ping FAIL*] server: ${_target}, target: ${_path}, times: ${pingFailures[key]}`)
            ),
            (_path === '/') ? (
              (pingFailures[key] >= config.tunnel.healthcheck.server.failures) && (
                pingFailures[key] = config.tunnel.healthcheck.server.failures,
                unhealthyServers.add(_target),
                setTunnelHealthy(_target, 0),
                serverTargetStructs[_target]?.forEach?.(
                  t => (
                    unhealthyTargets.add(t),
                    setTargetHealthy(t, 0)
                  )
                )
              )
            ) : (
              (pingFailures[key] >= config.tunnel.healthcheck.target.failures) && (
                pingFailures[key] = config.tunnel.healthcheck.target.failures,
                unhealthyTargets.add(key),
                setTargetHealthy(key, 0)
              )
            )
          ),
          e
        )
      )()
    )
  ),
  (
    $=>$
  )
)

.pipeline('healthcheck')
.serveHTTP(
  () => (
    (data = []) => (
      unhealthyTargets.forEach(e => data.push(e)),
      new Message(
        {
          headers: {
            'content-type': 'application/json'
          },
        },
        JSON.encode({ unhealthy: data })
      )
    )
  )()
)

.task(config.healthcheck.interval)
.onStart(() => new Message)
.replaceMessageStart(
  () => new MessageStart({
    method: 'GET',
    path: '/unhealthy',
    headers: {
      'Host': config.healthcheck.host,
      'Content-Type': 'application/json',
    }
  })
)
.encodeHTTPRequest()
.connect(
  () => `${config.healthcheck.host}:${config.healthcheck.port}`,
  { bufferLimit: '1m' }
)
.decodeHTTPResponse()
.handleData(
  data => (
    (obj = JSON.decode(data)) => (
      obj?.unhealthy && (
        unhealthyTargetCache.clear(),
        obj?.unhealthy.forEach(
          e => (
            unhealthyTargetCache.set(e, true),
            isDebugEnabled && (__thread.id === 0) && (
              console.log(`[*Unhealthy cache*] __thread.id: ${__thread.id}, unhealthy: ${e}`)
            )
          )
        )
      )
    )
  )()
)
.replaceMessage(new StreamEnd)

.task(config?.tunnel?.healthcheck?.server?.interval)
.onStart(
  () => (
    (_skipTask = (__thread.id !== 0)) ? (
      _probeCounter = { jobCount: 0 },
      new StreamEnd
    ) : (
      (jobs = null) => (
        jobs = Object.keys(tunnelServers).filter(
          e => tunnelServers[e].weight > 0
        ).map(
          e => new Message({ path: '/', target: e })
        ),
        _probeCounter = { jobCount: jobs.length },
        isDebugEnabled && (
          console.log(`[*Timer*] ping server count : ${jobs.length}`)
        ),
        jobs.length > 0 ? jobs : new StreamEnd
      )
    )()
  )
)
.branch(
  () => !_skipTask, (
    $=>$
    .demuxQueue().to(
      $=>$.link('ping')
    )
    .handleMessage(
      () => _probeCounter.jobCount--
    )
  ),
  (
    $=>$
  )
)
.wait(
  () => _probeCounter.jobCount <= 0
)
.replaceMessage(
  () => new StreamEnd
)

.task('1s')
.onStart(
  () => (
    (_skipTask = (__thread.id !== 0)) ? (
      _probeCounter = { jobCount: 0 },
      new StreamEnd
    ) : (
      (jobs = null, exist = {}) => (
        probeIndex >= slotCount && (probeIndex = 0),
        jobs = (slotArray[probeIndex] || []).filter(
          e => (!exist[e.key] && !unhealthyServers.has(e.server.target)) ? (exist[e.key] = true) : false
        ).map(
          e => new Message({ path: e.path, target: e.server.target })
        ),
        probeIndex++,
        _probeCounter = { jobCount: jobs.length },
        isDebugEnabled && (
          console.log(`[*Timer*] ping target count : ${jobs.length}`)
        ),
        jobs.length > 0 ? jobs : new StreamEnd
      )
    )()
  )
)
.branch(
  () => !_skipTask, (
    $=>$
    .demuxQueue().to('ping')
    .handleMessage(
      () => _probeCounter.jobCount--
    )
  ),
  (
    $=>$
  )
)
.wait(
  () => _probeCounter.jobCount <= 0
)
.replaceMessage(
  () => new StreamEnd
)

)()