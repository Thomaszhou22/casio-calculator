import { useState, useCallback, useRef, useEffect, type ReactNode } from 'react'

type Mode = 'comp' | 'complex' | 'stat' | 'table' | 'eqn' | 'ratio'

interface HistoryEntry {
  expr: string
  result: string
}

function formatNum(n: number): string {
  if (Number.isInteger(n)) {
    if (Math.abs(n) >= 1e15) return n.toExponential(10)
    return n.toLocaleString('en-US')
  }
  const absN = Math.abs(n)
  if (absN >= 1e10 || (absN < 1e-9 && absN > 0)) {
    return n.toExponential(10)
  }
  const rounded = Math.round(n * 1e12) / 1e12
  let str = String(rounded)
  if (str.replace(/[-.]/g, '').length > 14) {
    str = rounded.toPrecision(13).replace(/\.?0+$/, '')
  }
  return str
}

export default function App() {
  const [mode, setMode] = useState<Mode>('comp')
  const [angleUnit] = useState<'Deg' | 'Rad'>('Deg')
  const [shift, setShift] = useState(false)
  const [alpha, setAlpha] = useState(false)
  const [display, setDisplay] = useState('')
  const [result, setResult] = useState('')
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [showModeMenu, setShowModeMenu] = useState(false)
  const [error, setError] = useState(false)
  const [power, setPower] = useState(true)
  const displayRef = useRef<HTMLDivElement>(null)

  const clearModifiers = useCallback(() => {
    setShift(false)
    setAlpha(false)
  }, [])

  const insertText = useCallback((text: string) => {
    setError(false)
    setResult('')
    setDisplay(prev => prev + text)
  }, [])

  const deleteLast = useCallback(() => {
    setError(false)
    setResult('')
    setDisplay(prev => {
      if (prev.length === 0) return ''
      // Try to remove multi-char tokens first
      const tokens = [
        'sin⁻¹(', 'cos⁻¹(', 'tan⁻¹(',
        'sinh⁻¹(', 'cosh⁻¹(', 'tanh⁻¹(',
        'sin(', 'cos(', 'tan(',
        'sinh(', 'cosh(', 'tanh(',
        'log(', 'ln(', 'logₐ(',
        '√(', 'abs(', 'Ans',
        '(-1)', 'ᴇ', 'π',
        '°', '%'
      ]
      for (const t of tokens) {
        if (prev.endsWith(t)) {
          return prev.slice(0, -t.length)
        }
      }
      return prev.slice(0, -1)
    })
  }, [])

  const allClear = useCallback(() => {
    setDisplay('')
    setResult('')
    setError(false)
  }, [])

  // Safe math evaluation
  const safeEval = useCallback((expr: string): string => {
    try {
      let processed = expr
        .replace(/√\(/g, 'Math.sqrt(')
        .replace(/³√\(/g, 'Math.cbrt(')
        .replace(/×/g, '*')
        .replace(/÷/g, '/')
        .replace(/−/g, '-')
        .replace(/\^2/g, '**2')
        .replace(/\^3/g, '**3')
        .replace(/\^/g, '**')
        .replace(/ᴇ/gi, 'e')
        .replace(/abs\(/g, 'Math.abs(')

      // Factorials
      processed = processed.replace(/(\d+(?:\.\d+)?)!/g, (_, n) => {
        const num = parseFloat(n)
        if (num < 0 || !Number.isInteger(num)) return '(NaN)'
        let r = 1
        for (let i = 2; i <= num; i++) r *= i
        return String(r)
      })

      // Percent
      processed = processed.replace(/(\d+(?:\.\d+)?)%/g, '($1/100)')

      // DMS
      processed = processed.replace(/(\d+(?:\.\d+)?)°(\d+)'?(\d+)?"?/g, (_, d, m, s) => {
        return String(parseFloat(d) + parseFloat(m) / 60 + (s ? parseFloat(s) / 3600 : 0))
      })

      // Replace constants
      processed = processed.replace(/π/g, '(Math.PI)')
      processed = processed.replace(/\bAns\b/g, result || '0')

      // Log/ln
      processed = processed.replace(/\blog\(/g, 'Math.log10(')
      processed = processed.replace(/\bln\(/g, 'Math.log(')

      // Inverse trig - mark them before forward trig
      processed = processed.replace(/sin⁻¹\(/g, '__iasin(')
      processed = processed.replace(/cos⁻¹\(/g, '__iacos(')
      processed = processed.replace(/tan⁻¹\(/g, '__iatan(')

      // Hyperbolic - mark before forward trig
      processed = processed.replace(/sinh\(/g, '__sinh(')
      processed = processed.replace(/cosh\(/g, '__cosh(')
      processed = processed.replace(/tanh\(/g, '__tanh(')

      // Forward trig
      const useDeg = angleUnit === 'Deg'
      processed = processed.replace(/\bsin\(/g, useDeg ? '__sinD(' : 'Math.sin(')
      processed = processed.replace(/\bcos\(/g, useDeg ? '__cosD(' : 'Math.cos(')
      processed = processed.replace(/\btan\(/g, useDeg ? '__tanD(' : 'Math.tan(')

      // Replace e^ with Math.exp
      processed = processed.replace(/e\*\*/g, 'Math.exp(').replace(/Math\.exp\(/g, '__mexp(')
      // Actually handle e^x differently
      processed = processed.replace(/\be\b/g, '(Math.E)')

      const d2r = 'Math.PI/180'
      const r2d = '180/Math.PI'
      const helpers = `
        function __sinD(x){return Math.sin(x*${d2r});}
        function __cosD(x){return Math.cos(x*${d2r});}
        function __tanD(x){return Math.tan(x*${d2r});}
        function __sinh(x){return Math.sinh(x);}
        function __cosh(x){return Math.cosh(x);}
        function __tanh(x){return Math.tanh(x);}
        function __iasin(x){return Math.asin(x)*${useDeg ? r2d : '1'};}
        function __iacos(x){return Math.acos(x)*${useDeg ? r2d : '1'};}
        function __iatan(x){return Math.atan(x)*${useDeg ? r2d : '1'};}
        function __mexp(x){return Math.exp(x);}
      `

      // Fix e^ pattern: if we have (Math.E)**(...)
      processed = processed.replace(/\(Math\.E\)\*\*/g, 'Math.exp(')
      // Add closing paren for Math.exp - tricky, let's just handle e**n simple case
      // Actually let's not support e^ for now, the button inserts 'e^' which becomes '(Math.E)**'
      // For proper handling, we need to detect the exponent end

      const fn = new Function(`${helpers} return (${processed});`)
      const value = fn()

      if (typeof value === 'number') {
        if (!isFinite(value) || isNaN(value)) return 'Math ERROR'
        return formatNum(value)
      }
      return String(value)
    } catch {
      return 'Syntax ERROR'
    }
  }, [angleUnit, result])

  const handleEquals = useCallback(() => {
    if (!display) return
    const res = safeEval(display)
    if (res.includes('ERROR')) {
      setError(true)
      setResult(res)
    } else {
      setError(false)
      setResult(res)
      setHistory(prev => [...prev.slice(-9), { expr: display, result: res }])
    }
    clearModifiers()
  }, [display, safeEval, clearModifiers])

  // Keyboard support
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (!power) return
      const key = e.key
      if (/[0-9]/.test(key)) insertText(key)
      else if (key === '.') insertText('.')
      else if (key === '+') insertText('+')
      else if (key === '-') insertText('-')
      else if (key === '*') insertText('×')
      else if (key === '/') { e.preventDefault(); insertText('÷') }
      else if (key === '(' || key === ')') insertText(key)
      else if (key === '^') insertText('^')
      else if (key === '%') insertText('%')
      else if (key === 'Enter' || key === '=') { e.preventDefault(); handleEquals() }
      else if (key === 'Backspace') deleteLast()
      else if (key === 'Escape') allClear()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [power, insertText, handleEquals, deleteLast, allClear])

  const keyPress = useCallback((fn: () => void) => {
    fn()
    setTimeout(() => clearModifiers(), 50)
  }, [clearModifiers])

  // Button component
  const Btn = ({ 
    label, subYellow, subRed, onClick, className = ''
  }: { 
    label: ReactNode
    subYellow?: string
    subRed?: string
    onClick: () => void
    className?: string
  }) => (
    <button
      onClick={() => keyPress(onClick)}
      className={`relative bg-[#2a2a2a] hover:bg-[#3a3a3a] active:bg-[#1a1a1a] text-white rounded-lg flex flex-col items-center justify-center transition-all duration-75 shadow-md ${className}`}
      style={{ minHeight: '52px' }}
    >
      {subYellow && (
        <span className="absolute top-0.5 left-1 text-[8px] text-yellow-400 font-bold leading-none">{subYellow}</span>
      )}
      {subRed && (
        <span className="absolute top-0.5 right-1 text-[8px] text-red-400 leading-none">{subRed}</span>
      )}
      <span className="text-base sm:text-lg font-medium leading-none mt-1">{label}</span>
    </button>
  )

  const FnBtn = ({ label, onClick, className = '' }: { label: ReactNode; onClick: () => void; className?: string }) => (
    <button
      onClick={() => keyPress(onClick)}
      className={`bg-[#1f4d8a] hover:bg-[#2a5fa0] active:bg-[#1a4070] text-white rounded-lg flex items-center justify-center transition-all duration-75 shadow-md ${className}`}
      style={{ minHeight: '52px' }}
    >
      <span className="text-sm font-medium">{label}</span>
    </button>
  )

  const OpBtn = ({ label, onClick, className = '' }: { label: ReactNode; onClick: () => void; className?: string }) => (
    <button
      onClick={() => keyPress(onClick)}
      className={`bg-[#3d3d3d] hover:bg-[#4d4d4d] active:bg-[#2d2d2d] text-white rounded-lg flex items-center justify-center transition-all duration-75 shadow-md ${className}`}
      style={{ minHeight: '52px' }}
    >
      <span className="text-lg font-medium">{label}</span>
    </button>
  )

  if (!power) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-[#1a1a2e] to-[#0f0f1e] flex items-center justify-center p-4">
        <div className="w-full max-w-sm">
          <div className="bg-gradient-to-b from-[#e8e0d0] to-[#d0c8b8] rounded-3xl p-6 shadow-2xl border border-[#b0a890]">
            <div className="bg-[#1a1a1a] rounded-lg h-40 flex items-center justify-center mb-4">
              <button onClick={() => setPower(true)} className="text-gray-500 text-sm hover:text-gray-300">
                Press ON
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#1a1a2e] to-[#0f0f1e] flex items-center justify-center p-2 sm:p-4">
      <div className="w-full max-w-sm">
        {/* Calculator Body */}
        <div className="bg-gradient-to-b from-[#e8e0d0] to-[#c8c0b0] rounded-3xl p-3 sm:p-5 shadow-2xl border border-[#a0a090] relative">
          {/* Brand */}
          <div className="flex items-center justify-between mb-2 px-1">
            <div className="text-[#1a3a6a] font-bold text-sm tracking-wide">
              CASIO
              <span className="ml-1 text-[10px] font-normal text-gray-600">fx-991EX</span>
            </div>
            <div className="text-[#c00] text-[9px] font-bold">
              ClassWiz
            </div>
          </div>
          <div className="text-[8px] text-gray-500 mb-1 px-1">
            Natural V.P.A.M.
          </div>

          {/* Solar panel strip */}
          <div className="h-3 bg-gradient-to-r from-[#2a2a3a] via-[#3a3a4a] to-[#2a2a3a] rounded-sm mb-2 opacity-70" />

          {/* Screen */}
          <div className="bg-[#c8d8c8] border-2 border-[#8a9a8a] rounded-lg p-2 mb-3 min-h-[100px] flex flex-col">
            {/* Status bar */}
            <div className="flex justify-between text-[9px] text-[#1a3a1a] font-mono mb-1 px-1">
              <div className="flex gap-2">
                {shift && <span className="text-yellow-700 font-bold">S</span>}
                {alpha && <span className="text-red-700 font-bold">A</span>}
                <span>{angleUnit === 'Deg' ? 'D' : 'R'}</span>
              </div>
              <div className="uppercase">
                {mode === 'comp' ? 'COMP' : mode === 'complex' ? 'CMPLX' : mode === 'stat' ? 'STAT' : mode === 'table' ? 'TABLE' : mode === 'eqn' ? 'EQN' : 'RATIO'}
              </div>
              <div />
            </div>

            {/* Expression display */}
            <div className="flex-1 flex flex-col justify-end">
              <div className="text-right text-[#0a1a0a] text-lg sm:text-xl font-mono break-all min-h-[28px]" ref={displayRef}>
                {error ? (
                  <span className="text-red-800">{result}</span>
                ) : display || ''}
              </div>
              {result && !error && (
                <>
                  <div className="text-right text-[#0a1a0a] text-[10px] font-mono mt-0.5 opacity-60">━━━━━━━━━━</div>
                  <div className="text-right text-[#0a1a0a] text-lg sm:text-xl font-mono break-all">
                    {result}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Mode Menu Overlay */}
          {showModeMenu && (
            <div className="absolute inset-0 bg-[#e8e0d0] rounded-3xl z-10 p-4 flex flex-col">
              <div className="text-[#1a3a6a] font-bold text-sm mb-3">MODE</div>
              <div className="space-y-1 text-xs text-gray-800 flex-1 overflow-auto">
                <button onClick={() => { setMode('comp'); setShowModeMenu(false) }} className="w-full text-left px-2 py-1.5 hover:bg-[#d0c8b8] rounded">1: Calculation</button>
                <button onClick={() => { setMode('complex'); setShowModeMenu(false) }} className="w-full text-left px-2 py-1.5 hover:bg-[#d0c8b8] rounded">2: Complex</button>
                <button onClick={() => { setMode('stat'); setShowModeMenu(false) }} className="w-full text-left px-2 py-1.5 hover:bg-[#d0c8b8] rounded">3: Statistics</button>
                <button onClick={() => { setMode('table'); setShowModeMenu(false) }} className="w-full text-left px-2 py-1.5 hover:bg-[#d0c8b8] rounded">7: Table</button>
                <button onClick={() => { setMode('ratio'); setShowModeMenu(false) }} className="w-full text-left px-2 py-1.5 hover:bg-[#d0c8b8] rounded">8: Ratio</button>
              </div>
              <button onClick={() => setShowModeMenu(false)} className="text-xs bg-[#1f4d8a] text-white rounded-lg py-2 mt-2">Close</button>
            </div>
          )}

          {/* Top Row: SHIFT, ALPHA, Replay, MODE, ON */}
          <div className="grid grid-cols-6 gap-1.5 mb-1.5">
            <FnBtn label="SHIFT" onClick={() => { setShift(!shift); setAlpha(false) }} className="!bg-[#1a3a6a] !text-[10px] !min-h-[36px]" />
            <FnBtn label="ALPHA" onClick={() => { setAlpha(!alpha); setShift(false) }} className="!bg-[#6a1a1a] !text-[10px] !min-h-[36px]" />
            <button onClick={() => keyPress(() => insertText(''))} className="bg-[#1f4d8a] hover:bg-[#2a5fa0] text-white rounded-lg flex items-center justify-center text-xs min-h-[36px]">▲</button>
            <button onClick={() => keyPress(() => undefined)} className="bg-[#1f4d8a] hover:bg-[#2a5fa0] text-white rounded-lg flex items-center justify-center text-xs min-h-[36px]">▼</button>
            <FnBtn label="MODE" onClick={() => setShowModeMenu(true)} className="!bg-[#1f4d8a] !text-[10px] !min-h-[36px]" />
            <FnBtn label="ON" onClick={() => { allClear(); setPower(false) }} className="!bg-[#1f4d8a] !text-[10px] !min-h-[36px]" />
          </div>

          {/* Row 1: Function keys */}
          <div className="grid grid-cols-5 gap-1.5 mb-1.5">
            <Btn label="x²" subYellow="x³" subRed="A" onClick={() => insertText(shift ? '^3' : '^2')} className="!text-sm" />
            <Btn label="xⁿ" subYellow="√" subRed="B" onClick={() => insertText(shift ? '√(' : '^')} className="!text-sm" />
            <Btn label="log" subYellow="ˣ√" subRed="C" onClick={() => insertText(shift ? 'log(' : 'log(')} className="!text-sm" />
            <Btn label="ln" subYellow="eˣ" subRed="D" onClick={() => insertText(shift ? 'e^' : 'ln(')} className="!text-sm" />
            <Btn label="(–)" subYellow="π" subRed="E" onClick={() => insertText(shift ? 'π' : '-')} className="!text-sm" />
          </div>

          {/* Row 2: Trig + DMS */}
          <div className="grid grid-cols-5 gap-1.5 mb-1.5">
            <Btn label="°'" subYellow="DRG▶" subRed="F" onClick={() => insertText('°')} className="!text-sm" />
            <Btn label="hyp" subYellow="ABS" subRed="X" onClick={() => insertText('abs(')} className="!text-sm" />
            <Btn label="sin" subYellow="sin⁻¹" subRed="Y" onClick={() => insertText(shift ? 'sin⁻¹(' : 'sin(')} className="!text-sm" />
            <Btn label="cos" subYellow="cos⁻¹" subRed="M" onClick={() => insertText(shift ? 'cos⁻¹(' : 'cos(')} className="!text-sm" />
            <Btn label="tan" subYellow="tan⁻¹" subRed="N" onClick={() => insertText(shift ? 'tan⁻¹(' : 'tan(')} className="!text-sm" />
          </div>

          {/* Row 3: RCL, ENG, ( ) , S⇔D */}
          <div className="grid grid-cols-5 gap-1.5 mb-1.5">
            <Btn label="RCL" subYellow="STO" subRed="," onClick={() => insertText('Ans')} className="!text-xs" />
            <Btn label="ENG" subYellow="←" subRed=":" onClick={() => insertText('ᴇ')} className="!text-xs" />
            <Btn label="(" subYellow="%" subRed="x" onClick={() => insertText(shift ? '%' : '(')} className="!text-sm" />
            <Btn label=")" subYellow="1/x" subRed="y" onClick={() => insertText(shift ? '^(-1)' : ')')} className="!text-sm" />
            <Btn label="S⇔D" onClick={() => {
              if (result) {
                try {
                  const num = parseFloat(result.replace(/,/g, ''))
                  if (!isNaN(num)) setResult(String(num))
                } catch { /* noop */ }
              }
            }} className="!text-xs" />
          </div>

          {/* Row 4: 7,8,9,DEL,AC */}
          <div className="grid grid-cols-5 gap-1.5 mb-1.5">
            <Btn label="7" onClick={() => insertText('7')} className="!text-lg" />
            <Btn label="8" onClick={() => insertText('8')} className="!text-lg" />
            <Btn label="9" onClick={() => insertText('9')} className="!text-lg" />
            <OpBtn label="DEL" onClick={deleteLast} className="!text-xs !bg-[#5a1a1a] hover:!bg-[#6a2a2a]" />
            <OpBtn label="AC" onClick={allClear} className="!text-xs !bg-[#6a1a1a] hover:!bg-[#7a2a2a]" />
          </div>

          {/* Row 5: 4,5,6,×,÷ */}
          <div className="grid grid-cols-5 gap-1.5 mb-1.5">
            <Btn label="4" onClick={() => insertText('4')} className="!text-lg" />
            <Btn label="5" onClick={() => insertText('5')} className="!text-lg" />
            <Btn label="6" onClick={() => insertText('6')} className="!text-lg" />
            <OpBtn label="×" onClick={() => insertText('×')} />
            <OpBtn label="÷" onClick={() => insertText('÷')} />
          </div>

          {/* Row 6: 1,2,3,+,− */}
          <div className="grid grid-cols-5 gap-1.5 mb-1.5">
            <Btn label="1" onClick={() => insertText('1')} className="!text-lg" />
            <Btn label="2" onClick={() => insertText('2')} className="!text-lg" />
            <Btn label="3" onClick={() => insertText('3')} className="!text-lg" />
            <OpBtn label="+" onClick={() => insertText('+')} />
            <OpBtn label="−" onClick={() => insertText('-')} />
          </div>

          {/* Row 7: 0,.,×10ⁿ,Ans,= */}
          <div className="grid grid-cols-5 gap-1.5">
            <Btn label="0" onClick={() => insertText('0')} className="!text-lg" />
            <Btn label="." onClick={() => insertText('.')} className="!text-lg" />
            <Btn label="×10ⁿ" subYellow="π" onClick={() => insertText('ᴇ')} className="!text-sm" />
            <Btn label="Ans" subYellow="PreAns" onClick={() => insertText('Ans')} className="!text-sm" />
            <button
              onClick={() => keyPress(handleEquals)}
              className="bg-[#1a4a8a] hover:bg-[#2a5fa0] active:bg-[#103a70] text-white rounded-lg flex items-center justify-center transition-all duration-75 shadow-md"
              style={{ minHeight: '52px' }}
            >
              <span className="text-xl font-bold">=</span>
            </button>
          </div>

          {/* Bottom labels */}
          <div className="mt-3 flex justify-between text-[7px] text-gray-500 px-1">
            <span>CASIO COMPUTER CO., LTD. fx-991EX</span>
            <span>© CASIO</span>
          </div>
        </div>

        {/* Info */}
        <div className="mt-3 text-center text-gray-400 text-xs">
          <p>Casio fx-991EX ClassWiz</p>
          <p className="mt-1 text-[10px] opacity-60">键盘输入支持 | SHIFT/ALPHA 切换功能</p>
        </div>

        {/* History */}
        {history.length > 0 && (
          <div className="mt-4 bg-[#1e1e2e] rounded-lg p-3 max-h-40 overflow-auto">
            <div className="text-gray-400 text-xs mb-2 font-bold">History</div>
            {history.slice().reverse().map((h, i) => (
              <div key={i} className="text-gray-300 text-xs font-mono py-1 border-b border-gray-700 last:border-0">
                <div className="text-gray-500">{h.expr}</div>
                <div className="text-green-400">= {h.result}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
