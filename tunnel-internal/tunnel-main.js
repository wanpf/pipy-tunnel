((
  { config } = pipy.solve('config.js'),
  isDebugEnabled = config?.global?.enableDebug,

  listIssuingCA = [],

  tlsConfig = (
    (tls = {}) => (
      Object.entries(config.servers || {}).map(
        ([k, v]) => (
          tls[k] = {
            crt: v.tlsCert && new crypto.Certificate(pipy.load(v.tlsCert)),
            key: v.tlsKey && new crypto.PrivateKey(pipy.load(v.tlsKey)),
            ca: v.tlsCA && new crypto.Certificate(pipy.load(v.tlsCA)),
          },
          (!tls[k].crt || !tls[k].key || !tls[k].ca) ? (
            console.log(`[*warning*] server: ${k} missing tls config.`),
            delete tls[k]
          ) : listIssuingCA.push(tls[k].ca)
        )
      )
      ,
      tls
    )
  )(),

  pipyTunnelActiveConnectionGauge = new stats.Gauge('pipy_tunnel_active_connection', ['source_ip', 'destination']),
  pipyTunnelTotalConnectionCounter = new stats.Counter('pipy_tunnel_total_connection', ['source_ip', 'destination']),
  pipyTunnelSendBytesTotalCounter = new stats.Counter('pipy_tunnel_send_bytes_total', ['source_ip', 'destination']),
  pipyTunnelReceiveBytesTotalCounter = new stats.Counter('pipy_tunnel_receive_bytes_total', ['source_ip', 'destination']),

) => pipy({
  _isPing: false,
  _isTunnel: false,
  _path: undefined,
  _target: undefined,
  _serverAddr: undefined,
  _error: null,
})

.pipeline('startup')
.handleStreamStart(
  () => (
    _serverAddr = `${__inbound.localAddress}:${__inbound.localPort}`,
    !config.servers[_serverAddr] && (_serverAddr = __inbound.localPort),
    isDebugEnabled && (
      console.log(`[*connection*], address: ${_serverAddr}, TLS: ${Boolean(tlsConfig[_serverAddr])}`)
    )
  )
)
.branch(
  () => tlsConfig[_serverAddr], (
    $=>$
    .acceptTLS({
      certificate: () => ({
        cert: tlsConfig[_serverAddr].crt,
        key: tlsConfig[_serverAddr].key,
      }),
      trusted: listIssuingCA,
    }).to(
      $=>$.link('tunneling')
    )
  ),
  (
    $=>$.link('tunneling')
  )
)

.pipeline('connecting')
.replaceMessage(
  msg => (
    _path = msg.head.path,
    new Message
  )
)
.demux().to(
  $=>$
  .replaceMessage(
    () => [new Data, new StreamEnd]
  )
  .connect(() => _path,
    {
      connectTimeout: '1s',
      readTimeout: '1s'
    }
  )
  .replaceData(
    () => new Data
  )
  .replaceStreamEnd(
    e => (
      (e.error === 'ConnectionRefused' || e.error === 'ConnectionTimeout') && (
        _error.msg = e.error
      ),
      (e.error === "ReadTimeout") ? new Data : e
    )
  )
)

.pipeline('tunneling')
.demuxHTTP().to(
  $=>$
  .handleMessageStart(
    msg => (
      _path = msg?.head?.path,
      (_isPing = (msg?.head?.headers?.['x-pipy-probe'] === 'PING')) || (_isTunnel = (msg?.head?.method === 'CONNECT'))
    )
  )
  .branch(
    () => _isPing, (
      $=>$
      .branch(
        () => _path === '/', (
          $=>$
          .replaceMessage(
            () => (
              new Message({ status: 200, headers: { 'x-pipy-probe': 'PONG' } })
            )
          )
        ), (
          $=>$
          .replaceMessage(
            () => (
              _error = {},
              new Message({path: _path})
            )
          )
          .link('connecting')
          .replaceStreamEnd(
            () => (
              isDebugEnabled && (
                console.log(`[*ping*] target: ${_path}, error: ${_error?.msg || 'NOERR'}`)
              ),
              _error?.msg ? (
                new Message({ status: 200, headers: { 'x-pipy-probe': 'FAIL' } })
              ) : (
                new Message({ status: 200, headers: { 'x-pipy-probe': 'PONG' } })
              )
            )
          )
        )
      )
    ),
    () => _isTunnel, (
      $=>$
      .acceptHTTPTunnel(
        msg => (
          _target = msg.head.path,
          new Message({ status: 200 })
        )
      ).to(
        $=>$
        .onStart(
          ()  =>  new Data
        )
        .handleStreamStart(
          () => _target && (
            pipyTunnelActiveConnectionGauge.withLabels(__inbound.remoteAddress, _target).increase(),
            pipyTunnelTotalConnectionCounter.withLabels(__inbound.remoteAddress, _target).increase()
          )
        )
        .handleData(
          data => _target && (
            pipyTunnelSendBytesTotalCounter.withLabels(__inbound.remoteAddress, _target).increase(data.size)
          )
        )
        .connect(() => _target, { retryCount: config.policies?.connectRetry })
        .handleData(
          data => _target && (
            pipyTunnelReceiveBytesTotalCounter.withLabels(__inbound.remoteAddress, _target).increase(data.size)
          )
        )
        .handleStreamEnd(
          () => (
            _target && pipyTunnelActiveConnectionGauge.withLabels(__inbound.remoteAddress, _target).decrease()
          )
        )
      )
    ),
    (
      $=>$.replaceMessage(
          new Message({ status: 404 }, 'Not Found')
      )
    )
  )
)

)()