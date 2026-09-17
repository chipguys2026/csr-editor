import { useMemo, useState } from 'react'
import { useParamStore } from '@/store/params-store'
import { useRegisterStore } from '@/store/register-store'
import { exportToExcel, generateExcelData } from '@/lib/excel-export'
import { Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const ExcelPage = () => {
  const { moduleName, dataWidth, addrWidth, interface: csrInterface, parameters } =
    useParamStore()
  const registers = useRegisterStore((state) => state.registers)
  const [activeTab, setActiveTab] = useState('registers')

  // parameters go along too: an array's count resolves through them, so the
  // flattened sheet cannot expand a bank without them.
  const params = useMemo(
    () => ({ moduleName, dataWidth, addrWidth, interface: csrInterface, parameters }),
    [moduleName, dataWidth, addrWidth, csrInterface, parameters]
  )

  const excelData = useMemo(
    () => generateExcelData(params, registers),
    [params, registers]
  )

  const handleDownload = () => {
    exportToExcel(moduleName, params, registers)
  }

  return (
    <div className='flex flex-1 overflow-hidden rounded-lg border m-4'>
      {/* Left Sidebar */}
      <aside className='flex w-56 shrink-0 flex-col border-r'>
        <div className='border-b px-4 py-3'>
          <p className='text-sm font-medium'>Excel Preview</p>
          <p className='text-muted-foreground text-xs'>
            3 sheet(s)
          </p>
        </div>

        <div className='flex-1 overflow-auto p-2'>
          <button
            type='button'
            className={cn(
              'flex w-full items-center rounded-md px-3 py-2 text-left text-sm transition-colors',
              activeTab === 'summary'
                ? 'bg-accent text-accent-foreground'
                : 'hover:bg-accent/60'
            )}
            onClick={() => setActiveTab('summary')}
          >
            Summary
          </button>
          <button
            type='button'
            className={cn(
              'flex w-full items-center rounded-md px-3 py-2 text-left text-sm transition-colors',
              activeTab === 'registers'
                ? 'bg-accent text-accent-foreground'
                : 'hover:bg-accent/60'
            )}
            onClick={() => setActiveTab('registers')}
          >
            Registers
          </button>
          <button
            type='button'
            className={cn(
              'flex w-full items-center rounded-md px-3 py-2 text-left text-sm transition-colors',
              activeTab === 'flat registers'
                ? 'bg-accent text-accent-foreground'
                : 'hover:bg-accent/60'
            )}
            onClick={() => setActiveTab('flat registers')}
          >
            Flat Registers
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <div className='flex min-w-0 flex-1 flex-col'>
        <div className='flex items-center justify-between border-b px-4 py-3'>
          <h3 className='font-medium capitalize'>{activeTab}</h3>
          <Button onClick={handleDownload} className='gap-2' size='sm'>
            <Download className='h-4 w-4' />
            Download Excel
          </Button>
        </div>

        <div className='flex-1 overflow-auto p-4'>
          {activeTab === 'summary' && (
            <div className='border rounded-lg overflow-hidden max-w-2xl'>
              <table className='w-full text-sm'>
                <thead>
                  <tr className='bg-blue-600 text-white'>
                    <th className='px-4 py-2 text-left border'>Parameter</th>
                    <th className='px-4 py-2 text-left border'>Value</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className='even:bg-muted/30'>
                    <td className='px-4 py-2 border font-medium'>Module Name</td>
                    <td className='px-4 py-2 border'>{excelData.summary.moduleName}</td>
                  </tr>
                  <tr className='even:bg-muted/30'>
                    <td className='px-4 py-2 border font-medium'>Data Width</td>
                    <td className='px-4 py-2 border'>{excelData.summary.dataWidth} bits</td>
                  </tr>
                  <tr className='even:bg-muted/30'>
                    <td className='px-4 py-2 border font-medium'>Address Width</td>
                    <td className='px-4 py-2 border'>{excelData.summary.addrWidth} bits</td>
                  </tr>
                  <tr className='even:bg-muted/30'>
                    <td className='px-4 py-2 border font-medium'>Interface</td>
                    <td className='px-4 py-2 border'>{excelData.summary.interface}</td>
                  </tr>
                  <tr className='even:bg-muted/30'>
                    <td className='px-4 py-2 border font-medium'>Generated At</td>
                    <td className='px-4 py-2 border'>{excelData.summary.generatedAt}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          {activeTab === 'registers' && (
            <div className='border rounded-lg overflow-hidden'>
              <div className='overflow-x-auto'>
                <table className='w-full text-sm'>
                  <thead>
                    <tr className='bg-blue-600 text-white'>
                      <th className='px-3 py-2 text-left border min-w-[80px]'>Address</th>
                      <th className='px-3 py-2 text-left border min-w-[120px]'>Register Name</th>
                      <th className='px-3 py-2 text-left border min-w-[140px]'>Field Name</th>
                      <th className='px-3 py-2 text-left border min-w-[100px]'>Bit Range</th>
                      <th className='px-3 py-2 text-right border min-w-[60px]'>Width</th>
                      <th className='px-3 py-2 text-center border min-w-[60px]'>Type</th>
                      <th className='px-3 py-2 text-right border min-w-[80px]'>Reset Value</th>
                      <th className='px-3 py-2 text-left border min-w-[300px]'>Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    {excelData.registers.map((row, idx) => (
                      <tr
                        key={idx}
                        className={`${row.isRegisterRow ? 'bg-gray-200 dark:bg-gray-700' : ''}`}
                      >
                        <td className={`px-3 py-2 border font-mono ${row.isRegisterRow ? 'font-bold' : ''}`}>
                          {row.address}
                        </td>
                        <td className={`px-3 py-2 border ${row.isRegisterRow ? 'font-bold' : ''}`}>
                          {row.registerName}
                        </td>
                        <td className='px-3 py-2 border'>{row.fieldName}</td>
                        <td className='px-3 py-2 border font-mono'>{row.bitRange}</td>
                        <td className='px-3 py-2 border text-right'>{row.width}</td>
                        <td className='px-3 py-2 border text-center'>{row.type}</td>
                        <td className='px-3 py-2 border text-right font-mono'>{row.resetValue}</td>
                        <td className={`px-3 py-2 border ${row.isRegisterRow ? 'italic' : ''}`}>
                          {row.description}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'flat registers' && (
            <div className='overflow-hidden rounded-lg border'>
              <div className='overflow-x-auto'>
                <table className='w-full text-sm'>
                  <thead>
                    <tr className='bg-blue-600 text-white'>
                      <th className='min-w-[100px] border px-3 py-2 text-left'>Address</th>
                      <th className='min-w-[180px] border px-3 py-2 text-left'>Register Name</th>
                      <th className='min-w-[140px] border px-3 py-2 text-left'>Field Name</th>
                      <th className='min-w-[100px] border px-3 py-2 text-left'>Bit Range</th>
                      <th className='min-w-[60px] border px-3 py-2 text-right'>Width</th>
                      <th className='min-w-[60px] border px-3 py-2 text-center'>Type</th>
                      <th className='min-w-[80px] border px-3 py-2 text-right'>Reset Value</th>
                      <th className='min-w-[300px] border px-3 py-2 text-left'>Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    {excelData.flat.map((row, idx) => (
                      <tr
                        key={idx}
                        className={row.isRegisterRow ? 'bg-gray-200 dark:bg-gray-700' : ''}
                      >
                        <td className={`border px-3 py-2 font-mono ${row.isRegisterRow ? 'font-bold' : ''}`}>
                          {row.address}
                        </td>
                        <td className={`border px-3 py-2 ${row.isRegisterRow ? 'font-bold' : ''}`}>
                          {row.registerName}
                        </td>
                        <td className='border px-3 py-2'>{row.fieldName}</td>
                        <td className='border px-3 py-2 font-mono'>{row.bitRange}</td>
                        <td className='border px-3 py-2 text-right'>{row.width}</td>
                        <td className='border px-3 py-2 text-center'>{row.type}</td>
                        <td className='border px-3 py-2 text-right font-mono'>{row.resetValue}</td>
                        <td className={`border px-3 py-2 ${row.isRegisterRow ? 'italic' : ''}`}>
                          {row.description}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default ExcelPage
