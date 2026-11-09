import {
  NodeEntity,
  Property,
  Primary,
  SoftDelete,
  Filter,
  OneToMany,
  RelationshipCount,
  Repository,
} from '../../src/index'
import { clearFilterParams, setFilterParams } from '../../src/index'
import { openBackend, TestBackend } from './support/backend'

// ---- Fixtures (per-file: decorator registry is global per module registry) --
//
// (FilterPost)-[:HAS]->(FilterComment) — the comments carry the filters:
// soft delete (label state) + a parameterised tenant filter. Every
// "filtered relation" scenario composes through the comment model.

@NodeEntity()
@SoftDelete()
@Filter({ name: 'tenant', where: 'node.tenant = $tenant' })
class FilterComment {
  @Primary()
  @Property({ type: 'string' })
  commentID!: string

  @Property({ type: 'string' })
  tenant!: string

  static create(commentID: string, tenant: string): FilterComment {
    const comment = new FilterComment()
    comment.commentID = commentID
    comment.tenant = tenant

    return comment
  }
}

@NodeEntity()
class FilterPost {
  @Primary()
  @Property({ type: 'string' })
  postID!: string

  @Property({ type: 'string' })
  title!: string

  @OneToMany(() => FilterComment, 'HAS', 'out', true)
  comments!: FilterComment[]

  @RelationshipCount({ type: 'HAS', target: () => FilterComment })
  commentCount!: number

  static create(postID: string, title: string): FilterPost {
    const post = new FilterPost()
    post.postID = postID
    post.title = title

    return post
  }
}

// ---------------------------------------------------------------------------

describe('named global filters (NTS-162)', () => {
  let backend: TestBackend
  let posts: Repository<FilterPost>
  let comments: Repository<FilterComment>

  const relateComment = async (postID: string, commentID: string): Promise<void> => {
    await backend.connection.run(
      'MATCH (p:FilterPost { postID: $postID }), (c:FilterComment { commentID: $commentID }) ' +
        'CREATE (p)-[:HAS]->(c)',
      { postID, commentID },
    )
  }

  beforeAll(async () => {
    backend = await openBackend()
    posts = backend.neode.getRepository(FilterPost)
    comments = backend.neode.getRepository(FilterComment)
  })

  beforeEach(async () => {
    await backend.clearGraph()
    clearFilterParams()

    setFilterParams('tenant', 'acme')

    await posts.save(FilterPost.create('p1', 'acme post'))
    await posts.save(FilterPost.create('p2', 'other post'))
    await comments.save(FilterComment.create('c1', 'acme'))
    await comments.save(FilterComment.create('c2', 'beta'))
  })

  afterAll(async () => {
    await backend.close()
  })

  it('default-on filters apply to find / get / all / repository reads', async () => {
    expect(await comments.find('c2')).toBeUndefined()
    expect(await comments.find('c1')).not.toBeNull()

    const got = await backend.neode.get(FilterComment, {})
    expect(got.map((comment) => comment.commentID)).toEqual(['c1'])

    const all = await backend.neode.all(FilterComment)
    expect(all.map((comment) => comment.commentID)).toEqual(['c1'])

    const fromRepository = await comments.findAll()
    expect(fromRepository.map((comment) => comment.commentID)).toEqual(['c1'])

    expect(await comments.count()).toBe(1)
    expect(await comments.countBy('tenant')).toEqual({ acme: 1 })
  })

  it('withoutFilters disables one named filter; the others stay active', async () => {
    // tenant off — both comments read
    const both = await comments.findAll({}, { withoutFilters: ['tenant'] })
    expect(both.map((comment) => comment.commentID).sort()).toEqual(['c1', 'c2'])

    await comments.delete('c2')

    // softDelete off, tenant still on — and the soft-deleted row does not
    // carry the base label anyway (labels-as-state), so it cannot resurrect
    const withoutSoft = await comments.findAll({}, { withoutFilters: ['softDelete'] })
    expect(withoutSoft.map((comment) => comment.commentID)).toEqual(['c1'])

    // includeDeleted (the NTS-510 spelling) opts back in alongside tenant
    const including = await comments.findAll(
      {},
      {
        includeDeleted: true,
        withoutFilters: ['tenant'],
      },
    )
    expect(including).toHaveLength(2)
  })

  it('parameterised filters re-read with setFilterParams', async () => {
    setFilterParams('tenant', 'beta')

    const all = await backend.neode.all(FilterComment)
    expect(all.map((comment) => comment.commentID)).toEqual(['c2'])
  })

  it('paginate honours the filters in both modes (data read and COUNT)', async () => {
    const page = await backend.neode.paginate(FilterComment, {}, { page: 1, limit: 10 })
    expect(page.total).toBe(1)
    expect(page.items.map((comment) => comment.commentID)).toEqual(['c1'])

    const unfiltered = await backend.neode.paginate(
      FilterComment,
      {},
      {
        page: 1,
        limit: 10,
        withoutFilters: ['tenant'],
      },
    )
    expect(unfiltered.total).toBe(2)

    const cursor = await backend.neode.paginate(
      FilterComment,
      {},
      {
        limit: 10,
        orderBy: 'commentID',
      },
    )
    expect(cursor.items.map((comment) => comment.commentID)).toEqual(['c1'])
  })

  it('a soft-deleted related node reads as ABSENT inside the eager comprehension — parent row SURVIVES', async () => {
    await relateComment('p1', 'c1')
    await relateComment('p1', 'c2')

    // Ordered read: p1 first regardless of the engine's row order
    const ordered = await backend.neode.all(FilterPost, {}, 'postID')
    const post = ordered.find((entry) => entry.postID === 'p1')

    // The beta comment is filtered out of the comprehension by the tenant filter
    expect(post?.comments.map((comment) => comment.commentID)).toEqual(['c1'])

    // Soft-delete the remaining comment: the label swap drops it from the
    // comprehension match — the relation reads [] and p1 still comes back
    await comments.delete('c1')

    const afterDelete = (await backend.neode.all(FilterPost, {}, 'postID')).find(
      (entry) => entry.postID === 'p1',
    )

    expect(afterDelete?.postID).toBe('p1')
    expect(afterDelete?.comments).toEqual([])
  })

  it('the projection COUNT sees the filtered targets too', async () => {
    await relateComment('p1', 'c1')
    await relateComment('p1', 'c2')

    const [post] = (await backend.neode.all(FilterPost, {}, 'postID')).filter(
      (entry) => entry.postID === 'p1',
    )

    // Two HAS relationships exist on p1; only the acme comment is counted
    expect(post?.commentCount).toBe(1)
  })

  it('bulk writes and raw cypher bypass the filters', async () => {
    // Raw cypher sees every row, filtered or not
    const raw = await backend.neode.readCypher(
      'MATCH (c:FilterComment) RETURN c.commentID AS id ORDER BY id',
      {},
    )
    expect(raw.records).toHaveLength(2)

    // deleteAll is a bulk write — every node carrying the labels goes,
    // including rows the read filters would have hidden
    const deleted = await comments.deleteAll({ tenant: 'beta' })
    expect(deleted).toBe(1)

    const left = await backend.neode.readCypher(
      'MATCH (c:FilterComment) RETURN count(c) AS count',
      {},
    )
    expect(Number(left.records[0]?.get('count'))).toBe(1)
  })
})
