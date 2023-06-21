((
  { config } = pipy.solve('config.js'),

) => (

pipy()

.branch(
  Boolean(config?.reverseServer?.target), ($=>$
    .task()
    .onStart(new Data)
    .replay().to($=>$
      .loop($=>$
        .onStart(new Data)
        .branch(
          () => config?.reverseServer?.tlsCert && config?.reverseServer?.tlsKey, ($=>$
            .connectTLS({
              certificate: () => ({
                cert: new crypto.Certificate(pipy.load(config?.reverseServer?.tlsCert)),
                key: new crypto.PrivateKey(pipy.load(config?.reverseServer?.tlsKey)),
              }),
              trusted: config?.reverseServer?.tlsCA ? [new crypto.Certificate(pipy.load(config?.reverseServer?.tlsCA))] : [],
            }).to($=>$
              .connect(() => config?.reverseServer?.target, { protocol: 'tcp', retryCount: 1, retryDelay: 1, ...config?.reverseServer })
            )
          ), ($=>$
            .connect(() => config?.reverseServer?.target, { protocol: 'tcp', retryCount: 1, retryDelay: 1, ...config?.reverseServer })
          )
        )
        .use('tunnel-main.js', 'tunneling')
      )
      .replaceStreamEnd(
        () => (
          new StreamEnd('Replay')
        )
      )
    )
  )
)

.repeat(
  Object.entries(config.servers || {}),
  ($, [addr, v])=>$
    .listen(addr, { protocol: 'tcp', ...v, ...(v.maxConnections > 0 && { maxConnections: Math.ceil(v.maxConnections / __thread.concurrency) }) })
    .onStart(new Data)
    .use('tunnel-main.js', 'startup')
)

))()
