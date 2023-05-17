((
  { config } = pipy.solve('config.js')
) => pipy()

.repeat(
  Object.entries(config.servers),
  ($, [addr, v])=>$
  .listen(addr, { protocol: 'tcp', ...v })
  .onStart(new Data)
  .use('tunnel-main.js', 'startup')
)

)()