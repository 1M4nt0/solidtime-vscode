import {createTimeEntry} from '../api/organizations/[orgId]/time-entries/post.index'
import {updateTimeEntry} from '../api/organizations/[orgId]/time-entries/[entryId]'
import {Logger} from './injection'
import {inject, injectable} from 'inversify'

const DEFAULT_IDLE_THRESHOLD_MS = 120_000
const IDLE_WATCHER_INTERVAL_MS = 30_000
const ONE_MINUTE_MS = 60_000

/**
 * Represents a segment of time tracked for a specific workspace.
 */
interface TimeSlice {
  /** The identifier of the workspace where time is being tracked. */
  workspace: string
  /** The timestamp (in milliseconds) when this time slice started. */
  startedAt: number
  /** The timestamp (in milliseconds) when this time slice ended. Optional, as a slice might still be active. */
  endedAt?: number
}

/**
 * Defines the contract for a storage driver that can save and load time slices.
 */
interface StorageDriver {
  /**
   * Saves an array of time slices to the storage.
   * @param slices - An array of TimeSlice objects to be saved.
   */
  save(slices: TimeSlice[]): void
  /**
   * Loads time slices from the storage that fall within a given time range.
   * @param fromMs - The start timestamp (in milliseconds) of the time range.
   * @param toMs - The end timestamp (in milliseconds) of the time range.
   * @returns An array of TimeSlice objects that match the criteria.
   */
  load(fromMs: number, toMs: number): TimeSlice[]
}

/**
 * An in-memory implementation of the StorageDriver, primarily for local testing or simple use cases.
 * Data is not persisted across sessions.
 */
class LocalFileStorageService implements StorageDriver {
  private data: TimeSlice[] = []

  /**
   * Saves an array of time slices to the in-memory store.
   * @param slices - An array of TimeSlice objects to be saved.
   */
  save(slices: TimeSlice[]): void {
    this.data.push(...slices)
  }

  /**
   * Loads time slices from the in-memory store that fall within a given time range.
   * @param fromMs - The start timestamp (in milliseconds) of the time range.
   * @param toMs - The end timestamp (in milliseconds) of the time range.
   * @returns An array of TimeSlice objects that match the criteria.
   */
  load(fromMs: number, toMs: number): TimeSlice[] {
    return this.data.filter((s) => s.startedAt <= toMs && (s.endedAt ?? Date.now()) >= fromMs)
  }
}

/**
 * Configuration options for the TimeTrackerService.
 */
interface TrackerOptions {
  /** The identifier for the current workspace. */
  workspace: string
  /** The storage driver to be used for persisting time slices. */
  storage: StorageDriver
  /**
   * The threshold (in milliseconds) after which inactivity is detected and the current time slice is ended.
   * Defaults to DEFAULT_IDLE_THRESHOLD_MS.
   */
  idleThresholdMs?: number
}

const TimeTrackerServiceSymbol = Symbol.for('TimeTrackerService')
const TimeTrackerServiceConfigSymbol = Symbol.for('TimeTrackerServiceConfig')

type TimeTrackerServiceConfig = {
  orgId: string
  memberId: string
  workspace: string
  storage: StorageDriver
  idleThresholdMs?: number
}

/**
 * Service responsible for tracking time, managing time slices, and syncing with a remote API.
 * It handles user activity, idle detection, and periodic synchronization of time entries.
 */
@injectable()
class TimeTrackerService {
  private readonly orgId: string
  private readonly memberId: string
  private timer: NodeJS.Timeout | null = null
  private currentRemoteId: string | null = null
  private syncedMs = 0
  private readonly idleThreshold: number
  private currentSlice: TimeSlice | null = null
  private readonly sliceBuffer: TimeSlice[] = []
  private lastActivity = Date.now()
  private readonly storage: StorageDriver
  private readonly workspace: string

  /**
   * Creates an instance of TimeTrackerService.
   * @param orgId - The organization ID.
   * @param memberId - The member ID.
   * @param opts - Configuration options for the tracker.
   */
  constructor(@inject(TimeTrackerServiceConfigSymbol) config: TimeTrackerServiceConfig) {
    this.orgId = config.orgId
    this.memberId = config.memberId
    this.storage = config.storage
    this.workspace = config.workspace
    this.idleThreshold = config.idleThresholdMs ?? DEFAULT_IDLE_THRESHOLD_MS
    this._startIdleWatcher()
  }

  /**
   * Call this method when user activity is detected.
   * It updates the last activity timestamp and starts a new time slice if none is active.
   */
  onActivity(): void {
    this.lastActivity = Date.now()
    if (!this.currentSlice) this._beginSlice()
  }

  /**
   * Starts the time tracking service.
   * This initiates the periodic beat for syncing data.
   */
  start(): void {
    if (this.timer) return
    this._beat().catch(Logger().log)
    this.timer = setInterval(() => this._beat().catch(Logger().log), ONE_MINUTE_MS)
  }

  /**
   * Stops the time tracking service.
   * This clears the periodic beat interval.
   */
  stop(): void {
    if (this.timer) clearInterval(this.timer)
  }

  /**
   * Pauses the current time tracking.
   * This ends the current time slice.
   */
  pause(): void {
    this._endSlice()
  }

  /**
   * Resumes time tracking after a pause.
   * This begins a new time slice.
   */
  resume(): void {
    this._beginSlice()
  }

  /**
   * Flushes any buffered time slices to the storage.
   * This also ends the current time slice if one is active.
   */
  flush(): void {
    this._endSlice()
    if (this.sliceBuffer.length) {
      this.storage.save(this.sliceBuffer)
      this.sliceBuffer.length = 0
    }
  }

  /**
   * Calculates the total tracked time within a given date range.
   * @param from - The start date of the range.
   * @param to - The end date of the range.
   * @returns The total time in milliseconds.
   */
  getTotal(from: Date, to: Date): number {
    const items = this.storage.load(from.getTime(), to.getTime())
    return items.reduce((sum, s) => sum + ((s.endedAt ?? Date.now()) - s.startedAt), 0)
  }

  /**
   * Gets the currently active time slice.
   * @returns The current TimeSlice object, or null if no slice is active.
   */
  getOpenSlice(): TimeSlice | null {
    return this.currentSlice
  }

  /**
   * Gets the most recently closed time slice from the buffer.
   * @returns The last closed TimeSlice object, or undefined if the buffer is empty.
   */
  getLastClosedSlice(): TimeSlice | undefined {
    return this.sliceBuffer.at(-1)
  }

  /**
   * Starts the idle watcher interval.
   * If the user is inactive for longer than the configured idle threshold,
   * the current slice is automatically ended.
   */
  private _startIdleWatcher(): void {
    setInterval(() => {
      if (this.currentSlice && Date.now() - this.lastActivity >= this.idleThreshold) {
        this._endSlice()
      }
    }, Math.min(IDLE_WATCHER_INTERVAL_MS, this.idleThreshold / 2))
  }

  /**
   * Begins a new time slice.
   * Sets the current slice with the current workspace and start time.
   */
  private _beginSlice(): void {
    this.currentSlice = {
      workspace: this.workspace,
      startedAt: Date.now(),
    }
  }

  /**
   * Ends the current active time slice.
   * Sets the end time for the current slice and adds it to the buffer.
   * The current slice is then reset to null.
   */
  private _endSlice(): void {
    if (!this.currentSlice) return
    this.currentSlice.endedAt = Date.now()
    this.sliceBuffer.push(this.currentSlice)
    this.currentSlice = null
  }

  /**
   * The main beat function that runs periodically.
   * It flushes any buffered slices, and then syncs the current active slice
   * or the last closed slice with the remote API.
   * It creates a new time entry if one doesn't exist for the current session,
   * or updates an existing one.
   */
  private async _beat(): Promise<void> {
    this.flush()

    const active = this.getOpenSlice()
    Logger().log(`active: ${JSON.stringify(active)}`)

    if (active) {
      // Ongoing slice → create or patch single remote entry
      const currentTimestamp = Date.now()
      const totalMsSinceSliceStart = currentTimestamp - active.startedAt
      const deltaMsSinceLastSync = totalMsSinceSliceStart - this.syncedMs

      if (deltaMsSinceLastSync < ONE_MINUTE_MS) {
        return
      }

      if (this.currentRemoteId) {
        await updateTimeEntry(
          {
            orgId: this.orgId,
            entryId: this.currentRemoteId,
          },
          {
            end: new Date(currentTimestamp),
          }
        )
      } else {
        const res = await createTimeEntry(
          {
            orgId: this.orgId,
          },
          {
            member_id: this.memberId,
            project_id: active.workspace,
            start: new Date(active.startedAt),
            billable: true,
          }
        )
        this.currentRemoteId = res.data.id
      }
      this.syncedMs = totalMsSinceSliceStart
    } else if (this.currentRemoteId) {
      const lastClosedSlice = this.getLastClosedSlice()
      if (!lastClosedSlice) {
        Logger().log(
          'SolidTimeSyncer: No last closed slice found, but currentRemoteId is set. Resetting remote tracking.'
        )
        this.currentRemoteId = null
        this.syncedMs = 0
        return
      }

      await updateTimeEntry(
        {
          orgId: this.orgId,
          entryId: this.currentRemoteId,
        },
        {
          end: new Date(lastClosedSlice.endedAt!),
        }
      )

      this.currentRemoteId = null
      this.syncedMs = 0
    }
  }
}

export type {TimeSlice, StorageDriver, TrackerOptions, TimeTrackerServiceConfig}
export {TimeTrackerService, LocalFileStorageService, TimeTrackerServiceSymbol, TimeTrackerServiceConfigSymbol}
