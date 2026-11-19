import { Construction } from 'lucide-react'

import { PageHeader } from '@/components/common'

/** 10/16 결정: 아직 구현되지 않은 기능은 화면 자리만 보여준다 */
export function PlaceholderPage({ title, description, plan }: { title: string; description: string; plan: string }) {
  return (
    <>
      <PageHeader title={title} description={description} />
      <div className="p-8">
        <div className="bg-card text-muted-foreground flex flex-col items-center gap-3 rounded-lg border border-dashed px-6 py-16 text-center">
          <Construction className="size-8" />
          <p className="text-foreground font-medium">준비 중인 화면입니다</p>
          <p className="max-w-md text-sm">{plan}</p>
        </div>
      </div>
    </>
  )
}
