async function getPosts(): Promise<{ slug: string; title: string }[]> {
  const res = await fetch('https://example.com/api/posts')
  return res.json()
}

export default async function BlogPage() {
  const posts = await getPosts()
  return (
    <main>
      <h1>Blog</h1>
      <ul>
        {posts.map((post) => (
          <li key={post.slug}>
            <a href={`/blog/${post.slug}`}>{post.title}</a>
          </li>
        ))}
      </ul>
    </main>
  )
}
