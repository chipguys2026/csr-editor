import { useErrorBoundary } from 'react-error-boundary'
import { Button } from '@/components/ui/button'
import { RotateCcw } from 'lucide-react'

const Error = ({ error }) => {
  const { resetBoundary } = useErrorBoundary()

  console.log(error)

  return (
    <div className='flex h-screen w-screen flex-col items-center justify-center gap-1'>
      <span className='font-doto text-6xl'>Error</span>
      <p>Đã có lỗi xảy ra</p>
      <pre className='border-destructive text-destructive-foreground w-[90%] rounded-lg border p-2 text-wrap'>
        {error.message || JSON.stringify(error)}
      </pre>
      <Button
        variant='outline'
        onClick={resetBoundary}
      >
        <RotateCcw />
        Thử lại
      </Button>
    </div>
  )
}

export default Error
