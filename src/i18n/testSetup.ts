import { LANGUAGES, loadLanguage } from './index'

await Promise.all(LANGUAGES.map(({ code }) => loadLanguage(code)))
