// Library surface: re-export the shared headless core. Presentation (chalk
// formatters, spinner, Ink UI) stays out of the public surface — it lives in
// the bin and in @kud/jenkins-ink.
export * from "@kud/jenkins"
