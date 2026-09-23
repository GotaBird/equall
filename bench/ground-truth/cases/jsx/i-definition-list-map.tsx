type Spec = { term: string; value: string }

export function SpecList({ specs }: { specs: Spec[] }) {
  return (
    <dl className="grid grid-cols-2 gap-2">
      {specs.map((spec) => (
        <SpecRow key={spec.term} spec={spec} />
      ))}
    </dl>
  )
}

function SpecRow({ spec }: { spec: Spec }) {
  return (
    <>
      <dt>{spec.term}</dt>
      <dd>{spec.value}</dd>
    </>
  )
}
