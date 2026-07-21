import { create, all } from 'mathjs'

const math = create(all, { number: 'number' })

export type CalcMode = 'comp' | 'complex' | 'stat' | 'table' | 'eqn' | 'matrix' | 'ratio' | 'ineq'

export interface CalcState {
  mode: CalcMode
  angleUnit: 'Deg' | 'Rad'
  shift: boolean
  alpha: boolean
  expression: string
  result: string
  history: string[]
  memory: number
}

export function evaluate(expression: string, angleUnit: 'Deg' | 'Rad' = 'Deg'): string {
  try {
    let expr = expression
      // Replace calculator-specific symbols
      .replace(/√/g, 'sqrt')
      .replace(/³√/g, 'cbrt')
      .replace(/×/g, '*')
      .replace(/÷/g, '/')
      .replace(/−/g, '-')
      .replace(/π/g, 'pi')
      .replace(/²$/g, '^2')
      .replace(/ᴇ/gi, 'E')

    // Handle factorials
    expr = expr.replace(/(\d+)!/g, (_, n) => {
      const num = parseInt(n)
      let result = 1
      for (let i = 2; i <= num; i++) result *= i
      return String(result)
    })

    // Handle percent
    expr = expr.replace(/(\d+(?:\.\d+)?)%/g, '($1/100)')

    // Handle degrees/minutes/seconds
    if (expr.includes('°')) {
      expr = expr.replace(/(\d+)°(\d+)'?(\d+)?"?/g, (_, d, m, s) => {
        return String(parseFloat(d) + parseFloat(m) / 60 + (s ? parseFloat(s) / 3600 : 0))
      })
    }

    const config: any = {
      ...(angleUnit === 'Deg' ? {} : {})
    }

    const node = math.parse(expr)
    const code = node.compile()
    
    // Set angle mode
    if (angleUnit === 'Deg') {
      // math.js uses radians by default for trig functions
      // We need to convert
    }

    const value = code.evaluate(config)

    if (typeof value === 'number') {
      if (!isFinite(value)) return 'Math ERROR'
      if (isNaN(value)) return 'Math ERROR'
      
      // Format result
      if (Math.abs(value) < 1e-10 && value !== 0) {
        return value.toExponential(10).replace(/\.?0+e/, 'ᴇ')
      }
      
      const rounded = Math.round(value * 1e10) / 1e10
      return formatNumber(rounded)
    }
    
    return String(value)
  } catch (e) {
    return ''
  }
}

function formatNumber(n: number): string {
  if (Number.isInteger(n)) return n.toLocaleString('en-US')
  
  const absN = Math.abs(n)
  if (absN >= 1e10 || (absN < 1e-9 && absN > 0)) {
    return n.toExponential(10).replace(/e\+?/, 'ᴇ')
  }
  
  const str = String(n)
  if (str.length > 14) {
    return n.toPrecision(10).replace(/\.?0+$/, '')
  }
  return str
}

export function toRadians(deg: number): number {
  return deg * Math.PI / 180
}

export function toDegrees(rad: number): number {
  return rad * 180 / Math.PI
}

// Trig functions with angle unit support
export function sin(x: number, unit: 'Deg' | 'Rad'): number {
  return unit === 'Deg' ? Math.sin(toRadians(x)) : Math.sin(x)
}

export function cos(x: number, unit: 'Deg' | 'Rad'): number {
  return unit === 'Deg' ? Math.cos(toRadians(x)) : Math.cos(x)
}

export function tan(x: number, unit: 'Deg' | 'Rad'): number {
  return unit === 'Deg' ? Math.tan(toRadians(x)) : Math.tan(x)
}

export function asin(x: number, unit: 'Deg' | 'Rad'): number {
  const rad = Math.asin(x)
  return unit === 'Deg' ? toDegrees(rad) : rad
}

export function acos(x: number, unit: 'Deg' | 'Rad'): number {
  const rad = Math.acos(x)
  return unit === 'Deg' ? toDegrees(rad) : rad
}

export function atan(x: number, unit: 'Deg' | 'Rad'): number {
  const rad = Math.atan(x)
  return unit === 'Deg' ? toDegrees(rad) : rad
}

export { math }
