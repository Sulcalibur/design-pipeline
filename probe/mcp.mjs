/**
 * probe/mcp.mjs — just enough MCP to ask another process a question.
 *
 * The inspiration sources are MCP servers, not REST APIs. This connects over
 * stdio (newline-delimited JSON-RPC), initialises, calls one tool, and gets
 * out. It deliberately does not implement resources, prompts or sampling: the
 * probe needs discovery, nothing more.
 */
import { spawn } from 'node:child_process'

export class McpError extends Error {
  constructor(message) {
    super(message)
    this.name = 'McpError'
  }
}

/**
 * Connect to a stdio MCP server.
 *
 * @param {object} options
 * @param {string} options.command
 * @param {string[]} [options.args]
 * @param {Record<string,string>} [options.env]
 * @param {string} [options.cwd]
 * @param {number} [options.timeoutMs] per request, default 90s
 * @param {string} [options.label] name used in error messages
 */
export async function connectMcp({ command, args = [], env = {}, cwd, timeoutMs = 90000, label = 'mcp' }) {
  const child = spawn(command, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  let buffer = ''
  let stderr = ''
  let closed = false
  let nextId = 1
  const pending = new Map()

  const rejectAll = (error) => {
    for (const entry of pending.values()) {
      clearTimeout(entry.timer)
      entry.reject(error)
    }
    pending.clear()
  }

  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk) => {
    buffer += chunk
    let index
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index).trim()
      buffer = buffer.slice(index + 1)
      if (!line) continue
      let message
      try {
        message = JSON.parse(line)
      } catch {
        continue // servers sometimes log to stdout; ignore what is not JSON
      }
      if (message.id == null || !pending.has(message.id)) continue
      const entry = pending.get(message.id)
      pending.delete(message.id)
      clearTimeout(entry.timer)
      if (message.error) {
        entry.reject(new McpError(`${label}: ${message.error.message ?? 'request failed'}`))
      } else {
        entry.resolve(message.result)
      }
    }
  })
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk) => {
    stderr = (stderr + chunk).slice(-4000)
  })
  child.on('error', (error) => {
    closed = true
    rejectAll(new McpError(`${label}: ${error.message}`))
  })
  child.on('exit', (code, signal) => {
    closed = true
    const tail = stderr.trim().split('\n').filter(Boolean).pop()
    rejectAll(new McpError(`${label}: exited ${signal ?? code}${tail ? ` — ${tail}` : ''}`))
  })

  const request = (method, params, timeout = timeoutMs) =>
    new Promise((resolve, reject) => {
      if (closed) return reject(new McpError(`${label}: connection closed`))
      const id = nextId++
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new McpError(`${label}: ${method} timed out after ${timeout}ms`))
      }, timeout)
      pending.set(id, { resolve, reject, timer })
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
    })

  const notify = (method, params) => {
    if (!closed) child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n')
  }

  await request(
    'initialize',
    {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'probe-inspire', version: '1.0.0' },
    },
    20000,
  )
  notify('notifications/initialized')

  return {
    request,
    notify,
    async callTool(name, callArgs, timeout) {
      const result = await request('tools/call', { name, arguments: callArgs ?? {} }, timeout)
      if (result?.isError) {
        const text = result.content?.find((entry) => entry.type === 'text')?.text
        throw new McpError(`${label}: ${text ?? `${name} failed`}`)
      }
      return result
    },
    close() {
      if (closed) return
      closed = true
      for (const entry of pending.values()) {
        clearTimeout(entry.timer)
        entry.reject(new McpError(`${label}: closed before the response arrived`))
      }
      pending.clear()
      try {
        child.stdin.end()
      } catch {
        // already gone
      }
      child.kill('SIGTERM')
      setTimeout(() => {
        try {
          child.kill('SIGKILL')
        } catch {
          // already gone
        }
      }, 1500).unref?.()
    },
    get stderr() {
      return stderr
    },
  }
}

/** All text content joined, which is how most servers return tool output. */
export function mcpText(result) {
  return (result?.content ?? [])
    .filter((entry) => entry.type === 'text' && typeof entry.text === 'string')
    .map((entry) => entry.text)
    .join('\n')
}

/** The first text block that parses as JSON, or null. */
export function mcpJson(result) {
  for (const entry of result?.content ?? []) {
    if (entry.type !== 'text' || typeof entry.text !== 'string') continue
    try {
      return JSON.parse(entry.text)
    } catch {
      // keep looking
    }
  }
  return null
}
