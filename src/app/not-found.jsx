import { Button } from '@/components/ui/button'
import { ChevronLeft } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

const NotFound = () => {
  const navigate = useNavigate()

  return (
    <div className='flex h-screen w-screen flex-col items-center justify-center gap-1'>
      <span className='font-doto text-6xl'>404</span>
      <p>Không tìm thấy trang</p>
      <Button
        variant='outline'
        onClick={() => navigate(-1)}
      >
        <ChevronLeft />
        Quay lại
      </Button>
    </div>
  )
}

export default NotFound
