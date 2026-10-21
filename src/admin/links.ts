/**
 * Links from Studio numbers to the filtered Payload lists behind them. Payload's list view reads
 * `where` from the query string in the same nested form the REST API uses:
 *   ?where[or][0][and][0][status][equals]=paid&where[or][0][and][1][createdAt][greater_than_equal]=…
 */
export type Condition = [field: string, operator: string, value: string | number | boolean | Array<string | number>]

export function listUrl(collection: string, conditions: Condition[] = [], sort?: string): string {
  const params: string[] = []
  conditions.forEach(([field, operator, value], index) => {
    const key = `where[or][0][and][${index}][${field}][${operator}]`
    if (Array.isArray(value)) {
      value.forEach((item, i) => params.push(`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(String(item))}`))
    } else {
      params.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    }
  })
  if (sort) params.push(`sort=${encodeURIComponent(sort)}`)
  return `/admin/collections/${collection}${params.length ? `?${params.join('&')}` : ''}`
}

export function since(from: number): Condition {
  return ['createdAt', 'greater_than_equal', new Date(from).toISOString()]
}

export function before(to: number): Condition {
  return ['createdAt', 'less_than', new Date(to).toISOString()]
}
