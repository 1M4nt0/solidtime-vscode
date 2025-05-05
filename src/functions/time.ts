import { startOfDay, endOfDay, format } from 'date-fns'

class DateUtils {
  static DATE_FORMAT = 'yyyy-mm-dd'
  static UTC_DATE_TIME_FORMAT = "yyyy-MM-dd'T'HH:mm:ss'Z'"

  static now(): Date {
    return new Date()
  }

  static startOfDay(date: Date): Date {
    return startOfDay(date)
  }

  static endOfDay(date: Date): Date {
    return endOfDay(date)
  }

  static format(date: Date, formatStr: string): string {
    return format(date, formatStr)
  }
}

export { DateUtils }