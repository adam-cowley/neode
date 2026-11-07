#!/usr/bin/env node
/**
Imports the neode-ogm roadmap (phases + tasks + dependency tree)
into the Linear team "Neode" (NTS).

Uses the Linear MCP server (https://mcp.linear.app/mcp) for issue
creation, and Linear's GraphQL API for anything the MCP toolset
doesn't expose (projects, dependency relations, workflow states).

Usage:
  LINEAR_API_KEY=<key> node scripts/linear-import.mjs

Get a key: Linear → Settings → Security & access → Personal API keys
(needs Write permission for the Neode team).
*/

const LINEAR_API_KEY = process.env.LINEAR_API_KEY
const MCP_URL = 'https://mcp.linear.app/mcp'
const GRAPHQL_URL = 'https://api.linear.app/graphql'
const TEAM_KEY = 'NTS'

if (!LINEAR_API_KEY) {
  console.error('Set LINEAR_API_KEY (Linear → Settings → Security & access → Personal API keys)')
  process.exit(1)
}

// ---------------------------------------------------------------- utilities

/**
Streamable-HTTP MCP request. Returns parsed JSON (SSE-aware).
*/
async function mcp(sessionId, method, parameters) {
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    Authorization: `Bearer ${LINEAR_API_KEY}`,
  }
  if (sessionId) {
    headers['mcp-session-id'] = sessionId
  }

  const response = await fetch(MCP_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', id: mcp.nextId++, method, params: parameters }),
  })

  const newSession = response.headers.get('mcp-session-id')
  if (newSession) {
    mcp.sessionId = newSession
  }

  const contentType = response.headers.get('content-type') || ''
  const body = await response.text()

  if (!response.ok) {
    throw new Error(`MCP ${method} failed (${response.status}): ${body.slice(0, 300)}`)
  }

  // SSE response: take the last data: line containing our id
  let payload = body
  if (contentType.includes('text/event-stream')) {
    const lines = body.split('\n').filter((line) => line.startsWith('data:'))
    payload = lines.length > 0 ? lines.at(-1).slice(5).trim() : ''
  }

  const json = JSON.parse(payload)
  if (json.error) {
    throw new Error(`MCP ${method} error: ${JSON.stringify(json.error).slice(0, 300)}`)
  }
  return json.result
}

mcp.nextId = 1
mcp.sessionId = null

async function mcpInit() {
  await mcp(null, 'initialize', {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 'neode-ogm-roadmap-import', version: '1.0.0' },
  })

  // A JSON-RPC notification: no id, no response expected
  await fetch(MCP_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${LINEAR_API_KEY}`,
      'mcp-session-id': mcp.sessionId,
    },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
  })
}

async function mcpTool(name, arguments_) {
  const result = await mcp(mcp.sessionId, 'tools/call', { name, arguments: arguments_ })

  if (result.isError) {
    const text = result.content?.map((c) => c.text).join(' ') || 'unknown error'
    throw new Error(`MCP tool ${name} failed: ${text.slice(0, 400)}`)
  }

  const text = result.content?.map((c) => c.text).join('') || '{}'
  try {
    return JSON.parse(text)
  } catch {
    return { raw: text }
  }
}

/** Linear GraphQL. API keys authenticate as the raw Authorization header
value (no Bearer/Basic prefix). */
async function gql(query, variables = {}) {
  const response = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: LINEAR_API_KEY,
    },
    body: JSON.stringify({ query, variables }),
  })

  const { data, errors } = await response.json()

  if (errors) {
    throw new Error(`GraphQL failed: ${JSON.stringify(errors).slice(0, 400)}`)
  }

  return data
}

// ------------------------------------------------------------- import model

const PHASES = [
  {
    id: 'P0',
    title: 'Phase 0: Foundations & hygiene',
    description:
      'Toolchain modernisation and the test foundation. COMPLETE — see PLAN.md Phase 0 status.',
    done: true,
    tasks: [
      [
        'P0.1',
        'Toolchain: TS 5.9 strict, Vitest 3 + SWC decorator metadata, ESLint 9 flat config, Prettier',
        true,
      ],
      [
        'P0.2',
        'Port Cypher query builder in-tree (src/query), red-green, 37 unit tests; fixes neode or() connector bug; elementId-based whereId; no neo4j.Integer',
        true,
      ],
      [
        'P0.3',
        'Connection port (src/driver): ConnectionProvider/TransactionHandle over neo4j-driver 6 (Neo4j CE/EE, Memgraph) and embedded Relate engine',
        true,
      ],
      [
        'P0.4',
        'Integration harness: backend selection (OGM_TEST_BACKEND=relate|neo4j|memgraph) + capability probing (edition, constraints, temporals, points)',
        true,
      ],
      [
        'P0.5',
        'Bug fixes: hydrateRelationship OTHER_NODE copy-paste, delete() no-op (missing DELETE clause), MERGE never matching (defaults in merge map), dead code removal, uuid→crypto.randomUUID',
        true,
      ],
      ['P0.6', 'Turborepo workspace + GitHub Actions CI + vitest bench harness', true],
    ],
  },
  {
    id: 'P1',
    title: 'Phase 1: Metamodel & both definition methods',
    description:
      'Expand EntitySchema/PropertySchema to neode parity; add the map-based schema adapter alongside decorators; golden parity tests.',
    tasks: [
      [
        'P1.1',
        'Full property type set + value conversion (CleanValue port): temporal (date/time/datetime/localtime/localdatetime), point, duration, int/integer, float, boolean, arrays',
      ],
      [
        'P1.2',
        'Property options: required, hidden, protected, readonly, index, exists + default (value or function)',
      ],
      [
        'P1.3',
        'Map-based schema adapter: model(name, schema), with(models), withDirectory(dir), extend(model, as, using)',
      ],
      [
        'P1.4',
        'Decorator expansion: @Property, @Boolean, @Float, @DateTime, @Date, @Time, @LocalTime, @LocalDateTime, @Point, @Default, @OnCreateSet, @OnMatchSet, @Index, @Unique, @Required, @Hidden, @Protected, @Readonly; resolve @String global-type shadowing',
      ],
      ['P1.5', 'Multiple labels (sorted), extend() label addition, default primary key <label>_id'],
      [
        'P1.6',
        'Golden parity tests: decorated class ⇄ map definition produce identical EntitySchema',
      ],
    ],
  },
  {
    id: 'P2',
    title: 'Phase 2: Query builder completion',
    description: 'Finish the in-tree query builder to neode feature parity.',
    tasks: [
      [
        'P2.1',
        'Port EagerUtils (eagerNode/eagerPattern, MAX_EAGER_DEPTH=3) onto the in-tree builder',
      ],
      [
        'P2.2',
        'API parity checklist tests vs neode behaviour: relationship degrees (1, "1..2", "0..2", "..3"), where variants, set operators, orderBy forms',
      ],
    ],
  },
  {
    id: 'P3',
    title: 'Phase 3: Validation (Zod)',
    description:
      'Neode rule set powered by Zod, validators inside property type config, identical rule names in decorator and map APIs.',
    tasks: [
      [
        'P3.1',
        'Rule table: neode Joi rule names → Zod operations (min/max/email/regex/length/alphanum/…), unknown-rule errors',
      ],
      [
        'P3.2',
        'Temporal/point/duration Zod schemas over driver + Relate value types (SRID checks: 4326/4979/7203/9157)',
      ],
      [
        'P3.3',
        'ValidationError parity: collect-all-issues (abortEarly:false equivalent), details, input',
      ],
      ['P3.4', 'Wire validation into save/merge/update paths for both APIs'],
    ],
  },
  {
    id: 'P4',
    title: 'Phase 4: Query services to parity',
    description: 'Every neode query operation, on the connection port.',
    tasks: [
      [
        'P4.1',
        'CreateService: CREATE + nested relationship writes (WriteUtils port, MAX_CREATE_DEPTH)',
      ],
      ['P4.2', 'mergeOn(match, set) + mergeFields (unique + indexed)'],
      ['P4.3', 'UpdateService: update(props) — SET +=, readonly excluded, required props refilled'],
      [
        'P4.4',
        'Delete cascade: cascade delete AND detach (neode never shipped detach), depth control',
      ],
      [
        'P4.5',
        'relateTo/detachFrom: direction inversion for incoming, force_create, relationship properties',
      ],
      ['P4.6', 'Relationship update/delete services'],
      ['P4.7', 'all() ordering parity (string | {key} | array) + withinDistance'],
      ['P4.8', 'Multi-degree eager loading (depth ≤ 3) + hydration'],
      ['P4.9', 'Collection + toJson() parity (temporal/point JSON conversion, _id, _labels)'],
      ['P4.10', 'neode example app flow runs on neode-ogm (integration test)'],
    ],
  },
  {
    id: 'P5',
    title: 'Phase 5: Sessions, transactions, batch, config',
    description: 'Connection-level features to neode parity.',
    tasks: [
      [
        'P5.1',
        'batch(queries): all statements in one transaction, rollback on failure, TransactionError with per-statement errors',
      ],
      ['P5.2', 'fromEnv(): full NEO4J_* env var parity + tests'],
      ['P5.3', 'Multi-database: setDatabase + per-call override (capability-gated tests)'],
      [
        'P5.4',
        'Events: formalise EventType emitter (NODE_CREATED/MERGED/UPDATED/DELETED, RELATIONSHIP_*) + docs',
      ],
    ],
  },
  {
    id: 'P6',
    title: 'Phase 6: Schema sync',
    description: 'Modern constraint/index management.',
    tasks: [
      [
        'P6.1',
        'Indexes: CREATE INDEX IF NOT EXISTS FOR (n:Label) ON (n.prop), deterministic naming, drop',
      ],
      [
        'P6.2',
        'Enterprise existence constraints (REQUIRE n.prop IS NOT NULL), enterprise-gated + capability-probed',
      ],
      ['P6.3', 'install/drop round-trip tests vs SHOW CONSTRAINTS / SHOW INDEXES (Relate + Neo4j)'],
    ],
  },
  {
    id: 'P7',
    title: 'Phase 7: Repository pattern + instance API',
    description:
      'The full-flavour API layer: typed repositories and active-record instance methods.',
    tasks: [
      ['P7.1', 'Typed Repository<T> full surface: CRUD + query helpers + ordering/pagination'],
      ['P7.2', 'Instance methods on hydrated entities: save/update/delete/relateTo'],
      ['P7.3', 'registerRepository/getRepository wiring + integration tests'],
    ],
  },
  {
    id: 'P8',
    title: 'Phase 8: Benchmarks, docs, release',
    description: 'Performance baselines, documentation and publishing.',
    tasks: [
      ['P8.1', 'Bench suites: hydration, validation, e2e CRUD vs raw driver + vs neode'],
      ['P8.2', 'Docs: README, migration guide from neode, API reference'],
      ['P8.3', 'Packaging: final package name, exports map, ESM dual build, publish prep'],
      ['P8.4', 'Coverage thresholds + release checklist'],
    ],
  },
]

/**
Task-level dependencies: taskId → blocked by [taskIds]
*/
const TASK_DEPENDENCIES = {
  'P2.1': ['P1.1'],
  'P3.1': ['P1.1', 'P1.2'],
  'P3.2': ['P1.1'],
  'P3.4': ['P3.1', 'P3.3', 'P4.2'],
  'P4.8': ['P2.1'],
  'P4.10': ['P4.1', 'P4.4', 'P4.5', 'P4.7'],
  'P5.1': ['P4.1'],
  'P6.2': ['P1.2'],
  'P8.1': ['P4.8', 'P3.4'],
}

// ------------------------------------------------------------------- import

async function main() {
  const issueIds = {}

  console.log('▸ Initialising MCP session…')
  await mcpInit()

  const tools = await mcp(mcp.sessionId, 'tools/list', {})
  const toolNames = tools.tools.map((t) => t.name)
  console.log(`▸ MCP tools: ${toolNames.join(', ')}`)

  console.log('▸ Resolving team and states via GraphQL…')
  const teamData = await gql(
    `query($key: String!) {
            workflowStates(filter: { team: { key: { eq: $key } } }) { nodes { id name type } }
            teams(filter: { key: { eq: $key } }) { nodes { id name key } }
            projects(filter: { name: { eq: "neode-ogm" } }) { nodes { id name } }
        }`,
    { key: TEAM_KEY },
  )

  const team = teamData.teams.nodes[0]
  if (!team) {
    throw new Error(`Team ${TEAM_KEY} not found`)
  }

  const states = teamData.workflowStates.nodes
  const doneState =
    states.find((s) => s.type === 'completed') || states.find((s) => s.type === 'done')
  console.log(`▸ Team ${team.name} (${team.id}), done state: ${doneState?.id || 'none'}`)

  let projectId = teamData.projects.nodes[0]?.id

  if (projectId) {
    console.log(`▸ Project exists: neode-ogm (${projectId}) — reusing`)
  }

  // Look up existing issues across the whole team (idempotent re-runs)
  const existing = await gql(
    `query($teamKey: String!) {
            issues(filter: { team: { key: { eq: $teamKey } } }, first: 250) {
                nodes { id identifier title }
            }
        }`,
    { teamKey: TEAM_KEY },
  )

  for (const issue of existing.issues.nodes) {
    const phaseMatch = issue.title.match(/^Phase (\d):/)
    const taskMatch = issue.title.match(/^(P\d+\.\d+)\s*[—–-]/)

    if (phaseMatch) {
      issueIds[`P${phaseMatch[1]}`] = issue.id
    }
    if (taskMatch) {
      issueIds[taskMatch[1]] = issue.id
    }
  }

  console.log(`▸ Found ${Object.keys(issueIds).length} existing issues on team ${TEAM_KEY}`)

  // Create the project on a fresh run
  if (!projectId) {
    const projectData = await gql(
      `mutation($name: String!, $teamId: String!) {
                projectCreate(input: { name: $name, teamIds: [$teamId] }) {
                    project { id name }
                }
            }`,
      { name: 'neode-ogm', teamId: team.id },
    )
    projectId = projectData.projectCreate.project.id
    console.log(`▸ Project created: neode-ogm (${projectId})`)
  }

  for (const phase of PHASES) {
    if (issueIds[phase.id]) {
      console.log(`  = ${phase.id} already imported (${issueIds[phase.id]})`)
    } else {
      const phaseData = await gql(
        `mutation($input: IssueCreateInput!) {
                    issueCreate(input: $input) { issue { id identifier } }
                }`,
        {
          input: {
            teamId: team.id,
            projectId,
            title: phase.title,
            description: phase.description,
            stateId: phase.done ? doneState?.id : undefined,
          },
        },
      )

      const phaseIssue = phaseData.issueCreate.issue
      issueIds[phase.id] = phaseIssue.id
      console.log(`  ✓ ${phaseIssue.identifier} — ${phase.title}${phase.done ? ' (done)' : ''}`)
    }

    for (const task of phase.tasks) {
      const [taskId, taskTitle, taskDone] = task

      if (issueIds[taskId]) {
        continue
      }

      const taskData = await gql(
        `mutation($input: IssueCreateInput!) {
                    issueCreate(input: $input) { issue { id identifier } }
                }`,
        {
          input: {
            teamId: team.id,
            projectId,
            parentId: issueIds[phase.id],
            title: taskId,
            description: taskTitle,
            stateId: taskDone || phase.done ? doneState?.id : undefined,
          },
        },
      )

      const taskIssue = taskData.issueCreate.issue
      issueIds[taskId] = taskIssue.id
      console.log(`      ✓ ${taskIssue.identifier} — ${taskTitle.slice(0, 80)}`)
    }
  }

  // Dependency tree — Linear stores relations as "issueId BLOCKS relatedIssueId".
  // Phase N is blocked by phase N-1.
  console.log('▸ Phase dependencies…')
  for (let index = 1; index < PHASES.length; index++) {
    const blocker = PHASES[index - 1].id
    const blocked = PHASES[index].id

    await createRelation(issueIds[blocker], issueIds[blocked])

    console.log(`  ✓ ${blocker} blocks ${blocked}`)
  }

  console.log('▸ Task dependencies…')
  for (const [taskId, blockers] of Object.entries(TASK_DEPENDENCIES)) {
    for (const blocker of blockers) {
      await createRelation(issueIds[blocker], issueIds[taskId])

      console.log(`  ✓ ${blocker} blocks ${taskId}`)
    }
  }

  console.log('\n✔ Import complete.')
  console.log(`  Project: https://linear.app/team/project/${projectId}`)
}

const relationCache = new Map()

async function createRelation(blockerId, blockedId) {
  if (!relationCache.has(blockerId)) {
    const data = await gql(
      `query($id: String!) {
                issue(id: $id) { relations { nodes { type relatedIssue { id } } } }
            }`,
      { id: blockerId },
    )
    relationCache.set(blockerId, new Set(data.issue.relations.nodes.map((r) => r.relatedIssue.id)))
  }

  if (relationCache.get(blockerId).has(blockedId)) {
    return false
  }

  await gql(
    `mutation($issueId: String!, $relatedIssueId: String!) {
            issueRelationCreate(input: { issueId: $issueId, relatedIssueId: $relatedIssueId, type: blocks }) {
                issueRelation { id }
            }
        }`,
    { issueId: blockerId, relatedIssueId: blockedId },
  )

  relationCache.get(blockerId).add(blockedId)

  return true
}

main().catch((error) => {
  console.error(`\n✖ ${error.message}`)
  process.exit(1)
})
