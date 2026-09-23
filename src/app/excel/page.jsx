import { useMemo, useState } from 'react'
import { useParamStore } from '@/store/params-store'
import { useRegisterStore } from '@/store/register-store'
import { exportToExcel, generateExcelData } from '@/lib/excel-export'
import { Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SidebarItem, ViewShell } from '@/components/view-shell'

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

  const sheets = [
    { value: 'summary', label: 'Summary' },
    { value: 'registers', label: 'Registers' },
    { value: 'flat registers', label: 'Flat Registers' },
  ]

  return (
    <ViewShell
      layoutKey='excelSidebar'
      sidebarTitle='Sheets'
      sidebarSubtitle={`${sheets.length} sheet(s) in ${moduleName}.xlsx`}
      sidebar={sheets.map((sheet) => (
        <SidebarItem
          key={sheet.value}
          active={activeTab === sheet.value}
          onClick={() => setActiveTab(sheet.value)}
        >
          {sheet.label}
        </SidebarItem>
      ))}
      title={sheets.find((sheet) => sheet.value === activeTab)?.label}
      subtitle={
        activeTab === 'summary'
          ? 'Module parameters'
          : `${(activeTab === 'registers' ? excelData.registers : excelData.flat).length} row(s)`
      }
      actions={
        <Button
          onClick={handleDownload}
          className='gap-2'
          size='sm'
        >
          <Download className='h-4 w-4' />
          Download Excel
        </Button>
      }
    >
        <div className='flex-1 overflow-auto p-4'>
          {activeTab === 'summary' && (
            <div className='border rounded-lg overflow-hidden max-w-2xl'>
              <table className='w-full text-sm'>
                <thead>
                  <tr className='bg-muted/30 text-muted-foreground text-xs font-medium tracking-wide uppercase'>
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
                    <tr className='bg-muted/30 text-muted-foreground text-xs font-medium tracking-wide uppercase'>
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
                        className={`${row.isRegisterRow ? 'bg-muted/60' : 'hover:bg-muted/20'}`}
                      >
                        <td className={`px-3 py-2 border font-mono ${row.isRegisterRow ? 'font-bold' : ''}`}>
                          {row.address}
                        </td>
                        <td className={`px-3 py-2 border font-mono ${row.isRegisterRow ? 'font-bold' : ''}`}>
                          {row.registerName}
                        </td>
                        <td className='px-3 py-2 border font-mono'>{row.fieldName}</td>
                        <td className='px-3 py-2 border font-mono'>{row.bitRange}</td>
                        <td className='px-3 py-2 border text-right'>{row.width}</td>
                        <td className='px-3 py-2 border text-center font-mono'>{row.type}</td>
                        <td className='px-3 py-2 border text-right font-mono'>{row.resetValue}</td>
                        {/* The sheet wraps this column, so the preview has to
                            keep the line breaks rather than collapse them. */}
                        <td
                          className={`border px-3 py-2 align-top whitespace-pre-wrap ${row.isRegisterRow ? 'italic' : ''}`}
                        >
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
                    <tr className='bg-muted/30 text-muted-foreground text-xs font-medium tracking-wide uppercase'>
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
                        className={row.isRegisterRow ? 'bg-muted/60' : 'hover:bg-muted/20'}
                      >
                        <td className={`border px-3 py-2 font-mono ${row.isRegisterRow ? 'font-bold' : ''}`}>
                          {row.address}
                        </td>
                        <td className={`border px-3 py-2 font-mono ${row.isRegisterRow ? 'font-bold' : ''}`}>
                          {row.registerName}
                        </td>
                        <td className='border px-3 py-2 font-mono'>{row.fieldName}</td>
                        <td className='border px-3 py-2 font-mono'>{row.bitRange}</td>
                        <td className='border px-3 py-2 text-right'>{row.width}</td>
                        <td className='border px-3 py-2 text-center font-mono'>{row.type}</td>
                        <td className='border px-3 py-2 text-right font-mono'>{row.resetValue}</td>
                        <td
                          className={`border px-3 py-2 align-top whitespace-pre-wrap ${row.isRegisterRow ? 'italic' : ''}`}
                        >
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
    </ViewShell>
  )
}

export default ExcelPage
