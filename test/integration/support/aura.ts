/**
 * Aura API provisioning for the Aura smoke test (NTS-651).
 *
 * Creates a REAL, EPHEMERAL AuraDB instance through the Aura API (v2beta1),
 * waits for it to reach `running`, and destroys it — the test provisions in
 * `beforeAll` and tears down in `afterAll`, so nothing outlives the run.
 *
 * Credentials come from the environment and are never logged or written to
 * disk: AURA_CLIENT_ID / AURA_CLIENT_SECRET (Aura console → Account settings
 * → Client credentials), AURA_PROJECT_ID (the project the instance is
 * created in) and optionally AURA_ORG_ID (discovered from the project when
 * omitted).
 */
const AURA_API = 'https://api.neo4j.io/v2beta1'

interface AuraInstanceCredentials {
  instanceId: string
  uri: string
  username: string
  password: string
  /** Aura's default database is named by its id, not "neo4j" — callers must
   * target it explicitly (the test harness defaults to "neo4j", which Aura
   * rejects as an unknown graph reference) */
  defaultDatabase: string
}

export const isAuraConfigured = (): boolean =>
  Boolean(
    process.env.AURA_CLIENT_ID && process.env.AURA_CLIENT_SECRET && process.env.AURA_PROJECT_ID,
  )

const auraOrgId = (): string | undefined =>
  process.env.AURA_ORG_ID ?? process.env.AURA_ORGANIZATION_ID

async function bearerToken(): Promise<string> {
  const response = await fetch('https://api.neo4j.io/oauth/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(
        `${process.env.AURA_CLIENT_ID}:${process.env.AURA_CLIENT_SECRET}`,
      ).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  })
  if (!response.ok) {
    throw new Error(
      `Aura API token request failed (${response.status}) — check AURA_CLIENT_ID / AURA_CLIENT_SECRET`,
    )
  }

  return (await response.json()).access_token
}

async function auraGet(path: string, token: string): Promise<Record<string, unknown>> {
  const response = await fetch(`${AURA_API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!response.ok) {
    throw new Error(`Aura API GET ${path} failed (${response.status})`)
  }

  return (await response.json()).data
}

const sleep = (ms: number) => new Promise((resolve_) => setTimeout(resolve_, ms))

/**
 * The org holding AURA_PROJECT_ID. AURA_ORG_ID skips the search — the
 * credential can see many orgs, so an explicit id is the fast path.
 */
async function resolveOrgId(token: string): Promise<string> {
  if (auraOrgId()) {
    return auraOrgId() as string
  }

  const projectId = process.env.AURA_PROJECT_ID
  const orgs = ((await auraGet('/organizations', token)) ?? []) as { id: string }[]
  for (const org of orgs) {
    const projects = ((await auraGet(`/organizations/${org.id}/projects`, token)) ?? []) as {
      id: string
    }[]
    if (projects.some((project) => project.id === projectId)) {
      return org.id
    }
  }

  throw new Error(
    `Aura project ${projectId} not found in any org visible to this credential — set AURA_ORGANIZATION_ID explicitly`,
  )
}

/**
 * Create the instance and wait until it is running. Tries the free-tier
 * shape first (free-db on GCP), then free-db on AWS — a personal project
 * rejects the combination that does not fit its plan, and the API error
 * names it. The password appears EXACTLY ONCE, in the create response.
 */
async function createInstance(token: string, orgId: string): Promise<Record<string, unknown>> {
  const projectId = process.env.AURA_PROJECT_ID
  const name = `neode-aura-smoke-${Math.random().toString(36).slice(2, 8)}`
  const attempts = [
    { type: 'free', cloud_provider: 'gcp', region: 'europe-west1' },
    { type: 'free', cloud_provider: 'aws', region: 'eu-west-1' },
  ]

  let lastError = 'no create attempt was made'
  for (const attempt of attempts) {
    const response = await fetch(
      `${AURA_API}/organizations/${orgId}/projects/${projectId}/instances`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, ...attempt }),
      },
    )
    if (response.ok) {
      return (await response.json()).data as Record<string, unknown>
    }
    lastError = `${response.status} ${await response.text()}`
  }

  throw new Error(
    `Aura instance creation failed — plan does not allow any known free-tier shape. Last error: ${lastError}`,
  )
}

const INSTANCE_PREFIX = 'neode-aura-smoke-'
/** status lives under legacy_status in v2beta1; the fallback covers API drift */
const statusOf = (instance: Record<string, unknown>): string | undefined =>
  (instance.legacy_status ?? instance.status) as string | undefined

export async function provisionAuraInstance(): Promise<AuraInstanceCredentials> {
  const token = await bearerToken()
  const orgId = await resolveOrgId(token)
  const projectId = process.env.AURA_PROJECT_ID
  const projectPath = `/organizations/${orgId}/projects/${projectId}/instances`

  const existing = ((await auraGet(projectPath, token)) ?? []) as { id: string; name: string }[]
  if (existing.length > 0) {
    // Our own prefix = orphans of crashed earlier runs (the one-time
    // password is unknowable, so they can never be reused) — destroy and
    // start clean. Anything else in the project is not ours: refuse.
    for (const instance of existing) {
      if (!String(instance.name).startsWith(INSTANCE_PREFIX)) {
        throw new Error(
          `Aura project ${projectId} already holds a foreign instance ("${instance.name}") — the smoke test refuses ` +
            'to share a project (free-tier quota is one instance); point AURA_PROJECT_ID at an empty project',
        )
      }
    }
    for (const orphan of existing) {
      await fetch(`${AURA_API}${projectPath}/${orphan.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
    }
    await waitUntilGone(
      token,
      projectPath,
      existing.map((instance) => instance.id),
    )
  }

  const created = await createInstance(token, orgId)
  const password = created.password as string | undefined
  const uri = (created.connection_url ?? created.url) as string | undefined
  const defaultDatabase = created.default_database_id as string | undefined
  if (!password || !uri || !defaultDatabase) {
    // Keys only — never the values
    throw new Error(
      `Aura create response carried no password/connection_url/default_database_id (keys: ${Object.keys(created).join(', ')})`,
    )
  }

  // Poll until running: Aura provisioning takes minutes; 10s keeps the
  // free-tier rate limit (25 req/min) comfortably clear. The internal cap
  // is below the smoke test's beforeAll timeout so a hang surfaces as a
  // THROW (whose afterAll teardown still runs) instead of a hook timeout.
  const instancePath = `${projectPath}/${created.id}`
  for (let waited = 0; waited < 12 * 60 * 1000; waited += 10_000) {
    await sleep(10_000)
    const detail = await auraGet(instancePath, token)
    const status = statusOf(detail)
    if (status === 'running') {
      break
    }
    if (status === 'failed' || status === 'deleting' || status === 'destroying') {
      throw new Error(
        `Aura instance ${created.id} reached terminal status "${status}" during provisioning`,
      )
    }
  }

  return {
    instanceId: created.id,
    uri,
    username: created.username ?? 'neo4j',
    password,
    defaultDatabase,
  }
}

/**
 * Destroy instances and poll the project LIST until they no longer appear.
 * The detail endpoint 500s on instances being deleted (and never 404s),
 * so the list is the only reliable "gone" signal.
 *
 * Aura destroy is slow (the list can carry the instance for 10+ minutes
 * after the DELETE is accepted). The poll is deliberately best-effort: a
 * still-listed instance is warned about, not thrown — provisionAuraInstance
 * sweeps our own prefix's orphans on the next run, so cleanup is eventual.
 */
async function waitUntilGone(
  token: string,
  projectPath: string,
  instanceIds: string[],
): Promise<void> {
  const pending = new Set(instanceIds)
  for (let waited = 0; waited < 5 * 60 * 1000 && pending.size > 0; waited += 10_000) {
    await sleep(10_000)
    const listed: { id: string }[] = (await auraGet(projectPath, token)) ?? []
    for (const listed_ of listed) {
      pending.delete(listed_.id)
    }
  }
  if (pending.size > 0) {
    console.warn(
      `[aura] instance(s) ${[...pending].join(', ')} still deleting after the confirmation poll — ` +
        'the next run sweeps our own orphaned instances, no action needed unless it persists',
    )
  }
}

/**
 * Destroy the instance and poll the project list until it is gone.
 */
export async function destroyAuraInstance(instanceId: string): Promise<void> {
  const token = await bearerToken()
  const orgId = await resolveOrgId(token)
  const projectPath = `/organizations/${orgId}/projects/${process.env.AURA_PROJECT_ID}/instances`

  const response = await fetch(`${AURA_API}${projectPath}/${instanceId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!response.ok && response.status !== 404) {
    throw new Error(
      `Aura instance destroy failed (${response.status}) — instance ${instanceId} may be orphaned`,
    )
  }

  await waitUntilGone(token, projectPath, [instanceId])
}
