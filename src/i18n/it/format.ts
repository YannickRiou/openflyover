import type { Messages } from '../messages'

const messages: Messages['format'] = {
  kilobytes: '{value} KB',
  megabytes: '{value} MB',
  gigabytes: '{value} GB',
  percent: '{value}%',
  seconds: '{value} s',
  minutes: '{minutes} min',
  hoursMinutes: '{hours} h {minutes}',
  minutesSeconds: '{minutes} min {seconds}',
  ascent: 'D+ {value}',
  clock: '{hours}:{minutes}',
}

export default messages
