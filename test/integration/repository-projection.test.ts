import {
  Direction,
  NodeEntity,
  OneToMany,
  Primary,
  Property,
  Repository,
  RelationshipCount,
} from '../../src/index'
import { openBackend, TestBackend } from './support/backend'

// ---- Fixtures (per-file: decorator registry is global per module registry) --

@NodeEntity()
class Tag {
  @Primary()
  @Property({ type: 'string' })
  tagID!: string

  @Property({ type: 'string' })
  name!: string

  @OneToMany(() => Post, 'TAGGED', Direction.OUTGOING)
  tagged?: unknown
}

@NodeEntity()
class Post {
  @Primary()
  @Property({ type: 'string' })
  postID!: string

  @Property({ type: 'string' })
  title!: string

  /** NTS-136 — projected per read row; the projection path must run for repository reads too (NTS-501). */
  @RelationshipCount({ type: 'TAGGED', direction: 'in' })
  tagCount!: number
}

// ---------------------------------------------------------------------------

describe('Repository reads project read-model decorators (NTS-501)', () => {
  let backend: TestBackend
  let posts: Repository<Post>
  let tags: Repository<Tag>

  beforeAll(async () => {
    backend = await openBackend()
    posts = backend.neode.getRepository(Post)
    tags = backend.neode.getRepository(Tag)
  })

  afterEach(async () => {
    await backend.clearGraph()
  })

  afterAll(async () => {
    await backend.close()
  })

  it('findAll returns the projected relationship count', async () => {
    const post = await posts.save(Object.assign(new Post(), { postID: 'p1', title: 'Hello' }))
    const tag = await tags.save(Object.assign(new Tag(), { tagID: 't1', name: 'graph' }))

    const related = await backend.neode.relate(Tag, tag, post, 'TAGGED', {}, true)
    expect(related).toBeDefined()

    const all = await posts.findAll()

    expect(all).toHaveLength(1)
    expect(all[0]?.tagCount).toBe(1)
  })

  it('findBy returns the projected relationship count', async () => {
    const post = await posts.save(Object.assign(new Post(), { postID: 'p2', title: 'World' }))

    const found = await posts.findBy({ postID: 'p2' })

    expect(found?.postID).toBe(post.postID)
    expect(found?.tagCount).toBe(0)
  })

  it('findAllByIds returns the projected relationship count', async () => {
    const post = await posts.save(Object.assign(new Post(), { postID: 'p3', title: 'Hello' }))
    await posts.save(Object.assign(new Post(), { postID: 'p4', title: 'Other' }))
    const tag = await tags.save(Object.assign(new Tag(), { tagID: 't2', name: 'graph' }))

    await backend.neode.relate(Tag, tag, post, 'TAGGED', {}, true)

    const found = await posts.findAllByIds(['p3', 'p4'], { order: 'postID' })

    expect(found).toHaveLength(2)
    expect(found[0]?.tagCount).toBe(1)
    expect(found[1]?.tagCount).toBe(0)
  })
})
