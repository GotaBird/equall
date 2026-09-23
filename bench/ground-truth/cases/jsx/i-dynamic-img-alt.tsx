type Post = { cover: string; coverAlt: string; title: string }

export function PostCover({ post }: { post: Post }) {
  return (
    <figure>
      <img src={post.cover} alt={post.coverAlt} />
      <figcaption>{post.title}</figcaption>
    </figure>
  )
}
