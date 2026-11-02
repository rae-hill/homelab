export const languagesAndRuntimes = [
  "TypeScript",
  "Python",
  "SQL",
  "Rust",
  "Bash",
  "NodeJS",
  "Java",
  "Haskell",
  "Nix",
  "Ruby",
  "Terraform",
  "WebGL",
].sort()

export const librariesAndFrameworks = [
  "React",
  "Redux",
  "Rails",
  "RTK",
  "MUI",
  "SUI",
  "NextJS",
  "VueJS",
  "fastify",
  "SolidJS",
  "NestJS",
  "Effect",
  "fp-ts",
  "TypeORM",
  "RxJS",
  "Fastify",
  "Dioxus",
  "Liquibase",
  "Prisma",
  "AWS CDK",
  "Chakra-UI",
  "Cypress",
  "TensorflowJS",
  "K6",
  "Puppeteer",
].sort()

export const systemsDesign = [
  "AWS",
  "Google Cloud",
  "NixOS",
  "Lambda",
  "ECR",
  "EKS",
  "DynamoDB",
  "S3",
  "Cloudfront",
  "MSK",
  "SQS",
  "Async Pipelines",
  "ETLs",
  "PostgreSQL",
  "GraphQL",
  "NoSQL",
  "ETL",
  "Kubernetes",
  "Docker",
  "Microservices",
  "System Administration",
  "Hardware",
  "Recursive DNS",
  "VPS",
  "Offsite Backup",
].sort()

export const observabilityAndMetrics = [
  "OpenTelementry",
  "OpenTelemetry",
  "Prometheus",
  "Grafana",
  "Grafana Tempo",
  "Loki",
  "Alloy",
  "Tempo",
  "CloudWatch",
  "Splunk",
  "JournalD",
  "PagerDuty",
  "Observability",
].sort()

export const informationSecurity = [
  "RFC-6749 (OAuth2, OIDC)",
  "OAuth2",
  "OIDC",
  "RFC-9449 (DPoP)",
  "CSRF & XSS Mitigation",
  "ReBAC",
  "RBAC",
  "RFC-2674 (VLANs)",
  "RFC-1035 (DNS)",
  "RFC-8484 (DoH)",
  "RFC-8446 (TLS)",
  "RFC-5280 (x509)",
  "RFC-8200 (IPv6)",
  "RFC-6187 (SSH Certificates)",
].sort()

export const aiHarnesses = ["Kiro", "GitHub Copilot", "Kagi", "OpenWebUI"].sort()

/** The RFC specification tags from the information-security category. */
export const rfcTags = informationSecurity.filter((tag) => tag.startsWith("RFC-"))

export const functionalAndTheory = [
  "Functional Programming",
  "Category Theory",
  "Combinator TypeClasses",
  "Typeclasses",
  "Monads",
  "Recursion",
  "Open-Source Software",
].sort()

export const mathematics = [
  "Mathematics",
  "Numerical Linear Algebra",
  "Group Theory",
].sort()

export const dataAndSerialization = [
  "Runtime Validation",
  "Serializers",
  "Wire Transcoding",
].sort()

const tech = {
  aiHarnesses,
  languagesAndRuntimes,
  librariesAndFrameworks,
  systemsDesign,
  observabilityAndMetrics,
  informationSecurity,
  functionalAndTheory,
  mathematics,
  dataAndSerialization,
} as const

export const colorCoding: Record<
  keyof typeof tech,
  | "blue"
  | "red"
  | "green"
  | "border"
  | "bg"
  | "current"
  | `var(--${string})`
  | "black"
  | "transparent"
  | "white"
  | "whiteAlpha"
  | "blackAlpha"
  | "gray"
  | "orange"
  | "yellow"
  | "teal"
  | "cyan"
  | "purple"
  | "pink"
  | "fg"
> = {
  aiHarnesses: "var(--rh-resume-tag-colors-blue)",
  languagesAndRuntimes: "var(--rh-resume-tag-colors-green)",
  librariesAndFrameworks: "var(--rh-resume-tag-colors-orange)",
  systemsDesign: "var(--rh-resume-tag-colors-violet)",
  observabilityAndMetrics: "var(--rh-resume-tag-colors-red)",
  informationSecurity: "var(--rh-resume-tag-colors-yellow)",
  functionalAndTheory: "var(--rh-resume-tag-colors-brown)",
  mathematics: "var(--rh-resume-tag-colors-pink)",
  dataAndSerialization: "var(--rh-resume-tag-colors-teal)",
}

// const categorySets: ReadonlyArray<readonly [category: keyof typeof tech, techSet: ReadonlySet<string>]> = [
//   ["aiHarnesses", new Set(aiHarnesses)],
//   ["librariesAndFrameworks", new Set(librariesAndFrameworks)],
//   ["languagesAndRuntimes", new Set(languagesAndRuntimes)],
//   ["systemsDesign", new Set(systemsDesign)],
//   ["observabilityAndMetrics", new Set(observabilityAndMetrics)],
//   ["informationSecurity", new Set(informationSecurity)],
//   ["functionalAndTheory", new Set(functionalAndTheory)],
//   ["mathematics", new Set(mathematics)],
//   ["dataAndSerialization", new Set(dataAndSerialization)],
// ]

export function categoryColor(category: keyof typeof tech): string {
  return colorCoding[category]
}

export function techColor(_tech: string): string {
  return "white"
  //
  //   for(const [category, set] of categorySets) {
  //     if(set.has(tech)) {
  //       return colorCoding[category]
  //     }
  //   }
  //
  //   return "white"
}

/**
 * The full pool of known tags — the union of every category list above, de-duplicated and
 * sorted. Fed to the content editor's `TagsInput` as the available options for both the
 * experience and project sections.
 */
export const ALL_KNOWN_TAGS: ReadonlyArray<string> = Array.from(
  new Set([
    ...aiHarnesses,
    ...languagesAndRuntimes,
    ...librariesAndFrameworks,
    ...systemsDesign,
    ...observabilityAndMetrics,
    ...informationSecurity,
    ...functionalAndTheory,
    ...mathematics,
    ...dataAndSerialization,
  ]),
).sort((a, b) => a.localeCompare(b))
