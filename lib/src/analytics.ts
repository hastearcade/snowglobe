import * as csv from 'csv-writer'

export enum AnalyticType {
  'currentworld',
  'recvcommand',
  'issuecommand',
  'snapshotapplied',
  'snapshotgenerated',
  'worldhistory'
}

export class Analytics {
  private readonly data: Map<number, string[]> // tick number, map of analytic to data value

  // we need to store for every tick
  // a list of commands to process
  // any snapshots generated
  // any snapshots applied
  // world history at that tick
  // current world at that tick

  // Data structure
  // { tick0: {commands: string, snapshotsapplied: string, snapshotsgenerated: string, worldhistory: string, currentworld: string }}

  constructor(private readonly id: string) {
    this.data = new Map()
  }

  store(tickNumber: number, type: AnalyticType, data: string) {
    if (!this.data.has(tickNumber)) {
      this.data.set(tickNumber, ['', '', '', '', ''])
    }

    const dataStore = this.data.get(tickNumber)!
    dataStore[type] = data
  }

  async flush() {
    const csvWriter = csv.createArrayCsvWriter({
      path: `${this.id}-${Date.now()}.csv`,
      header: [
        'tick',
        'currentworld',
        'recvcommand',
        'issuecommand',
        'snapshotapplied',
        'snapshotgenerated',
        'worldhistory'
      ]
    })

    const data: any[][] = []
    this.data.forEach((val, key) => {
      data.push([key.toString()].concat(val))
    })

    await csvWriter.writeRecords(data)
  }
}
