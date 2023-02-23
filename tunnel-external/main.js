((
  { tunnelStartup } = pipy.solve('tunnel-init.js'),
) => (

  tunnelStartup(pipy())

))()