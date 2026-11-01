/**
 * Startup checks for the hosting environment.
 *
 * Several security-relevant behaviors key off NODE_ENV === 'production'
 * (trust proxy for per-client rate limit keys, secure cookies, setup/configure
 * refusal, CORS, morgan format). Railway does not set NODE_ENV for this
 * service, so a Railway deploy without it silently runs with development
 * behavior. This helper only produces a warning; it never changes behavior.
 */

type EnvLike = Record<string, string | undefined>

function sanitizeEnvValue(value: string): string {
  // Strip CR/LF and other control characters (log injection) and bound length.
  const printable = Array.from(value, (char) => {
    const code = char.charCodeAt(0)
    return code < 0x20 || code === 0x7f ? ' ' : char
  }).join('')
  return printable.replace(/ +/g, ' ').trim().slice(0, 64)
}

/**
 * Returns a warning message when running on Railway (RAILWAY_ENVIRONMENT or
 * RAILWAY_ENVIRONMENT_NAME is set) but NODE_ENV is not 'production'; null otherwise.
 * Only the environment name and NODE_ENV value are included -- never secrets.
 */
export function getRailwayNodeEnvWarning(env: EnvLike = process.env): string | null {
  const railwayEnvironment = env.RAILWAY_ENVIRONMENT_NAME || env.RAILWAY_ENVIRONMENT
  if (!railwayEnvironment) return null
  if (env.NODE_ENV === 'production') return null

  const nodeEnv = env.NODE_ENV ? sanitizeEnvValue(env.NODE_ENV) : '(unset)'
  return (
    `WARNING: Running on Railway (environment "${sanitizeEnvValue(railwayEnvironment)}") ` +
    `but NODE_ENV is ${nodeEnv}, not "production". Production-only protections are OFF: ` +
    'trust proxy (per-client rate limit keys), secure cookies, setup/configure refusal, ' +
    'production CORS, and morgan "short" logging. Set NODE_ENV=production in the Railway service variables.'
  )
}
