/**
 * Smoke Test Protocol
 *
 * After Gate 1 (tsc + lint + vitest) passes on an agent's worktree,
 * this protocol stands up a real Maslow server instance from that worktree,
 * runs behavioral smoke tests against real HTTP endpoints, and tears it down.
 *
 * This catches a class of bug that static checks miss:
 * - Server fails to start (missing env, bad imports, runtime errors)
 * - API returns wrong shape (schema drift)
 * - DB operations fail at runtime (bad SQL, missing columns)
 * - Routes return wrong status codes
 *
 * Used by AgentOrchestrator after Gate 1, before pushing the branch.
 */

import { execSync, spawn, type ChildProcess } from "child_process"
import * as http from "http"

export interface SmokeTestResult {
  passed: boolean
  testsRun: number
  testsPassed: number
  failures: SmokeTestFailure[]
  serverStartMs: number
  totalMs: number
}

export interface SmokeTestFailure {
  test: string
  expected: string
  actual: string
}

interface HttpResponse {
  status: number
  body: string
  parsed: unknown
}

const httpRequest = (
  port: number,
  method: string,
  path: string,
  body?: unknown,
  headers?: Record<string, string>
): Promise<HttpResponse> => {
  return new Promise((resolve, reject) => {
    const reqHeaders: Record<string, string> = {
      "Content-Type": "application/json",
      ...headers,
    }

    const bodyStr = body ? JSON.stringify(body) : undefined
    if (bodyStr) {
      reqHeaders["Content-Length"] = Buffer.byteLength(bodyStr).toString()
    }

    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method,
        headers: reqHeaders,
        timeout: 10_000,
      },
      (res) => {
        let data = ""
        res.on("data", (chunk: Buffer) => { data += chunk.toString() })
        res.on("end", () => {
          let parsed: unknown = null
          try { parsed = JSON.parse(data) } catch { parsed = data }
          resolve({ status: res.statusCode || 0, body: data, parsed })
        })
      }
    )

    req.on("error", reject)
    req.on("timeout", () => {
      req.destroy()
      reject(new Error("Request timed out"))
    })

    if (bodyStr) req.write(bodyStr)
    req.end()
  })
}

const waitForServer = async (port: number, timeoutMs: number): Promise<boolean> => {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await httpRequest(port, "GET", "/api/health")
      if (res.status === 200) return true
    } catch {
      // Server not ready yet
    }
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  return false
}

const findFreePort = (): number => {
  // Use a random high port to avoid collisions
  return 30000 + Math.floor(Math.random() * 20000)
}

/**
 * Run smoke tests against a worktree directory.
 *
 * 1. Build the server from the worktree
 * 2. Start the server on a random port
 * 3. Wait for /api/health to respond
 * 4. Run behavioral tests
 * 5. Kill the server
 * 6. Return results
 */
export const runSmokeTests = async (
  worktreeDir: string,
  onLog: (line: string) => void
): Promise<SmokeTestResult> => {
  const startTime = Date.now()
  const failures: SmokeTestFailure[] = []
  let testsRun = 0
  let testsPassed = 0
  let serverStartMs = 0
  let serverProcess: ChildProcess | null = null
  const port = findFreePort()

  const assert = (test: string, condition: boolean, expected: string, actual: string) => {
    testsRun++
    if (condition) {
      testsPassed++
      onLog(`  PASS: ${test}`)
    } else {
      failures.push({ test, expected, actual })
      onLog(`  FAIL: ${test} — expected ${expected}, got ${actual}`)
    }
  }

  try {
    // Step 1: Build
    onLog("[smoke] Building server from worktree...")
    try {
      execSync("npx tsc --outDir dist", {
        cwd: worktreeDir,
        stdio: "pipe",
        timeout: 120_000,
        env: { ...process.env, FORCE_COLOR: "0" },
      })
    } catch (err) {
      const execErr = err as { stderr?: Buffer }
      const output = execErr.stderr?.toString() || "Build failed"
      onLog(`[smoke] Build failed: ${output.slice(0, 500)}`)
      return {
        passed: false,
        testsRun: 0,
        testsPassed: 0,
        failures: [{ test: "build", expected: "tsc succeeds", actual: output.slice(0, 200) }],
        serverStartMs: 0,
        totalMs: Date.now() - startTime,
      }
    }

    // Step 2: Start the server
    onLog(`[smoke] Starting server on port ${port}...`)
    const serverStart = Date.now()

    serverProcess = spawn("node", ["dist/index.js"], {
      cwd: worktreeDir,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        PORT: port.toString(),
        NODE_ENV: "test",
        // Use a temp DB so smoke tests don't corrupt real data
        DATA_DIR: `${worktreeDir}/.smoke-data`,
        FORCE_COLOR: "0",
      },
    })

    // Capture server stderr for debugging
    let serverStderr = ""
    serverProcess.stderr?.on("data", (chunk: Buffer) => {
      serverStderr += chunk.toString()
    })

    // Step 3: Wait for health check
    const ready = await waitForServer(port, 30_000)
    serverStartMs = Date.now() - serverStart

    if (!ready) {
      onLog(`[smoke] Server failed to start within 30s. stderr: ${serverStderr.slice(0, 500)}`)
      return {
        passed: false,
        testsRun: 0,
        testsPassed: 0,
        failures: [{ test: "server-start", expected: "/api/health returns 200", actual: `Server did not start. ${serverStderr.slice(0, 200)}` }],
        serverStartMs,
        totalMs: Date.now() - startTime,
      }
    }

    onLog(`[smoke] Server ready in ${serverStartMs}ms. Running tests...`)

    // Step 4: Get auth token for subsequent requests
    let authToken = ""
    const envToken = process.env.MASLOW_AUTH_TOKEN || ""
    if (envToken) {
      try {
        const authRes = await httpRequest(port, "POST", "/api/auth/token", { token: envToken })
        if (authRes.status === 200) {
          const authData = authRes.parsed as { ok: boolean; data: { token: string } }
          authToken = authData.data?.token || ""
        }
      } catch {
        // Auth might be disabled in test mode — continue without token
      }
    }
    const authHeaders: Record<string, string> = authToken ? { Authorization: `Bearer ${authToken}` } : {}

    // === Smoke Tests ===

    // T1: Health check returns expected shape
    onLog("[smoke] Running tests...")
    const health = await httpRequest(port, "GET", "/api/health")
    assert(
      "GET /api/health → 200",
      health.status === 200,
      "200",
      String(health.status)
    )
    const healthData = health.parsed as { ok: boolean; data: { status: string; agents: { running: number } } }
    assert(
      "Health response has status field",
      healthData?.data?.status === "ok",
      "data.status === 'ok'",
      String(healthData?.data?.status)
    )

    // T2: Create a project
    const createProject = await httpRequest(port, "POST", "/api/projects", {
      name: "smoke-test-project",
      description: "Created by smoke test protocol",
    }, authHeaders)
    assert(
      "POST /api/projects → 201",
      createProject.status === 201,
      "201",
      String(createProject.status)
    )
    const project = (createProject.parsed as { ok: boolean; data: { id: string; name: string } })?.data
    assert(
      "Created project has id and name",
      !!project?.id && project?.name === "smoke-test-project",
      "id exists, name = 'smoke-test-project'",
      `id=${project?.id}, name=${project?.name}`
    )

    if (!project?.id) {
      onLog("[smoke] Cannot continue without project ID — aborting remaining tests")
      return {
        passed: false,
        testsRun,
        testsPassed,
        failures,
        serverStartMs,
        totalMs: Date.now() - startTime,
      }
    }

    // T3: List projects includes the one we created
    const listProjects = await httpRequest(port, "GET", "/api/projects", undefined, authHeaders)
    assert(
      "GET /api/projects → 200",
      listProjects.status === 200,
      "200",
      String(listProjects.status)
    )
    const projectsList = (listProjects.parsed as { ok: boolean; data: Array<{ id: string }> })?.data
    assert(
      "Projects list includes created project",
      Array.isArray(projectsList) && projectsList.some(p => p.id === project.id),
      "array contains our project",
      `array length=${projectsList?.length}`
    )

    // T4: Create a kanban card
    const createCard = await httpRequest(
      port, "POST", `/api/projects/${project.id}/cards`,
      { title: "Smoke test card", description: "Test card from smoke test protocol", column: "backlog" },
      authHeaders
    )
    assert(
      "POST /api/projects/:id/cards → 201",
      createCard.status === 201,
      "201",
      String(createCard.status)
    )
    const card = (createCard.parsed as { ok: boolean; data: { id: string; title: string } })?.data
    assert(
      "Created card has id and title",
      !!card?.id && card?.title === "Smoke test card",
      "id exists, title = 'Smoke test card'",
      `id=${card?.id}, title=${card?.title}`
    )

    if (card?.id) {
      // T5: Update card (move column)
      const updateCard = await httpRequest(
        port, "PUT", `/api/projects/${project.id}/cards/${card.id}`,
        { column: "in_progress" },
        authHeaders
      )
      assert(
        "PUT /api/projects/:id/cards/:cardId → 200",
        updateCard.status === 200,
        "200",
        String(updateCard.status)
      )

      // T6: Get board and verify card moved
      const board = await httpRequest(
        port, "GET", `/api/projects/${project.id}/cards`,
        undefined, authHeaders
      )
      assert(
        "GET /api/projects/:id/cards → 200",
        board.status === 200,
        "200",
        String(board.status)
      )
      const boardData = (board.parsed as {
        ok: boolean
        data: { backlog: Array<{ id: string }>; in_progress: Array<{ id: string }> }
      })?.data
      assert(
        "Card appears in in_progress column",
        Array.isArray(boardData?.in_progress) && boardData.in_progress.some(c => c.id === card.id),
        "in_progress contains our card",
        `in_progress length=${boardData?.in_progress?.length}`
      )

      // T7: Delete card
      const deleteCard = await httpRequest(
        port, "DELETE", `/api/projects/${project.id}/cards/${card.id}`,
        undefined, authHeaders
      )
      assert(
        "DELETE /api/projects/:id/cards/:cardId → 200",
        deleteCard.status === 200,
        "200",
        String(deleteCard.status)
      )
    }

    // T8: Messages endpoint responds
    const messages = await httpRequest(port, "GET", "/api/messages?limit=10", undefined, authHeaders)
    assert(
      "GET /api/messages → 200",
      messages.status === 200,
      "200",
      String(messages.status)
    )

    // T9: Conversations endpoint responds
    const conversations = await httpRequest(port, "GET", "/api/conversations?projectId=null", undefined, authHeaders)
    assert(
      "GET /api/conversations → 200",
      conversations.status === 200,
      "200",
      String(conversations.status)
    )

    // T10: Agents endpoint responds
    const agents = await httpRequest(port, "GET", "/api/agents", undefined, authHeaders)
    assert(
      "GET /api/agents → 200",
      agents.status === 200,
      "200",
      String(agents.status)
    )

    onLog(`[smoke] ${testsPassed}/${testsRun} tests passed`)
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    onLog(`[smoke] Unexpected error: ${errMsg}`)
    failures.push({ test: "unexpected-error", expected: "no errors", actual: errMsg })
  } finally {
    // Step 5: Kill the server
    if (serverProcess) {
      onLog("[smoke] Shutting down test server...")
      serverProcess.kill("SIGTERM")
      // Give it 3s to gracefully shutdown, then force kill
      await new Promise<void>(resolve => {
        const timeout = setTimeout(() => {
          serverProcess?.kill("SIGKILL")
          resolve()
        }, 3000)
        serverProcess!.on("exit", () => {
          clearTimeout(timeout)
          resolve()
        })
      })
    }
  }

  return {
    passed: failures.length === 0 && testsRun > 0,
    testsRun,
    testsPassed,
    failures,
    serverStartMs,
    totalMs: Date.now() - startTime,
  }
}
