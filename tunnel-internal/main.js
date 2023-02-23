(
  (
    { config } = pipy.solve('config.js'),

    tunnelStartup = (configuration) => (
      Object.keys(config.servers || {}).forEach(
        e => configuration.listen(e, {
          protocol: 'tcp',
          maxConnections: config.servers[e]?.maxConnections,
          readTimeout: config.servers[e]?.readTimeout,
          writeTimeout: config.servers[e]?.writeTimeout,
          idleTimeout: config.servers[e]?.idleTimeout,
        }).use('tunnel-main.js', 'startup')
      ),
      configuration
    ),

  ) => (

    tunnelStartup(pipy())

  )
)()