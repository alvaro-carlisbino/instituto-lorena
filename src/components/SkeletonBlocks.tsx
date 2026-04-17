type Props = {
  rows?: number
  card?: boolean
}

export function SkeletonBlocks({ rows = 4, card = true }: Props) {
  return (
    <div className={card ? 'panel skeleton-wrap' : 'skeleton-wrap'}>
      {Array.from({ length: rows }).map((_, index) => (
        <span key={`sk-${index}`} className="skeleton-line" />
      ))}
    </div>
  )
}
