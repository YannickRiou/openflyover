import { LANGUAGES, loadLanguage, setFrenchTypography } from './index'

await Promise.all(LANGUAGES.map(({ code }) => loadLanguage(code)))
setFrenchTypography(false)
