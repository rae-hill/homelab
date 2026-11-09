import { ABOUT_ME_DEFAULT, BLURB_DEFAULT } from "./defaults.js"
import type { ContentState } from "./types.js"

export { ABOUT_ME_DEFAULT, BLURB_DEFAULT }

/** Frozen version tag for the default content state. Patches persist in localStorage (tailor
 * entries) and decode against this base, so changing the default is a versioned contract
 * change. */
export const CONTENT_DEFAULTS_VERSION = "v1" as const

function bullets(entryId: string, texts: ReadonlyArray<string>) {
  return texts.map((text, i) => ({
    id: `${entryId}__b${i}`,
    text,
    visible: true,
  }))
}

const experience = [
  {
    id: "nutrien",
    company: "Nutrien (P3-Uplift)",
    location: "Loveland, CO (Remote)",
    roles: [{ title: "Senior Software Engineer", date: "June 2025 – June 2026" }],
    description:
      "Spearheaded a production support-tool microfrontend and deployed synchronization infrastructure and services that bridged internal and partner data sources via async pipelines. Provided L3 support and database analytics for production ERPs and connected systems.",
    bulletPoints: bullets("nutrien", [
      "Architected an async pipeline for high-precision PostGIS geospatial boundaries, enabling expanded operations for third-party autonomous vehicles, using MSK (Kafka), SQS, Lambda, and AWS CDK IaC.",
      "Spearheaded a support tool and framework for internal L3 support ticket resolution, using React, CloudFront, Apollo, and SSO (OIDC), significantly reducing time to resolution.",
      "Authored schemas for a federated Apollo Graph (GraphQL) used by other internal teams to power data operations, ETLs, and application interfaces.",
      "Provided data analytics and L3 support for production data issues stemming from async pipelines and distributed synchronization systems.",
    ]),
    tags: [
      "TypeScript",
      "Python",
      "Bash",
      "Docker",
      "AWS CDK",
      "CloudFront",
      "PostgreSQL",
      "RFC-6749 (OAuth2, OIDC)",
      "PagerDuty",
    ],
  },
  {
    id: "shutterfly",
    company: "Shutterfly (Spoonflower)",
    location: "Durham, NC (Remote)",
    roles: [{ title: "Senior Software Engineer 2", date: "July 2022 – March 2025" }],
    description:
      "Led the authentication replatforming initiative, migrated to AWS WAF Captcha, integrated with a partner tax platform for federal withholdings and royalties, and redesigned the entire artist marketplace experience from scratch.",
    bulletPoints: bullets("shutterfly", [
      "Engineered a hybrid SSR server using Terraform and K8s serving over 600,000 requests daily.  Introspected with Open Telemetry (OTel), NewRelic, ArgoCD, and Splunk.",
      "Retrofitted legacy codebases with a new W9 and W8 tax document vendor, saving thousands of personnel hours in manual document collation.",
      "Architected and implemented a backwards compatible OIDC compatible authentication system, paving the way for future replatforming and increased security throughout the site.",
      "Maintained a legacy Ruby on Rails codebase gradually transitioning to NodeJS microservices.",
    ]),
    tags: [
      "TypeScript",
      "Python",
      "Bash",
      "Terraform",
      "Kubernetes",
      "Docker",
      "VPS",
      "Splunk",
      "RFC-6749 (OAuth2, OIDC)",
      "Ruby",
      "Rails",
    ],
  },
  {
    id: "simspace",
    company: "SimSpace",
    location: "Boston, MA (Remote)",
    roles: [{ title: "Software Engineer 2", date: "March 2021 – July 2022" }],
    description:
      "Engineered a sophisticated quotas management UI to design specifications and analyzed Kubernetes system performance using a NodeJS-based browser emulation platform.",
    bulletPoints: bullets("simspace", [
      "Engineered VM interface load testing suites to benchmark critical virtual environment performance.",
      "Implemented sophisticated UI for managing an organization's VM resource availability, allocation, and access.",
      "Migrated legacy Redux Saga state management to Redux Toolkit listener middlewares.",
      "Established puppeteer-based browser performance profiling benchmark suite.",
    ]),
    tags: [
      "TypeScript",
      "React",
      "Nix",
      "Puppeteer",
      "K6",
      "Kubernetes",
      "Docker",
    ],
  },
  {
    id: "electronic-caregiver",
    company: "Electronic Caregiver",
    location: "Las Cruces, NM",
    roles: [{ title: "Software Engineer, Team Lead", date: "November 2019 – March 2021" }],
    description:
      "Integrated with partner peripherals using Web-Bluetooth, solved WebGL rendering anomalies, and engineered a patient management portal for care providers.",
    bulletPoints: bullets("electronic-caregiver", [
      "Maintained and tuned virtual assistant WebGL fragment and vertex shaders in AWS Sumerian.",
      "Technical lead and architect for pandemic symptom-checker app using WebBluetooth and RxJS.",
      "Overhauled virtual assistant speech track systems in AWS Lex and Lambda.",
      "Integrated Lambda deploy systems into IaC using TypeScript and GitHub actions.",
    ]),
    tags: [
      "TypeScript",
      "Python",
      "WebGL",
      "React",
      "Redux",
      "RxJS",
      "NestJS",
      "TypeORM",
    ],
  },
  {
    id: "indica-labs",
    company: "Indica Labs",
    location: "Albuquerque, NM",
    roles: [{ title: "Software Developer", date: "May 2019 – August 2019" }],
    description:
      "Engineered an arbitrarily deep file selector, and used tensorflow for image manipulation in real time.",
    bulletPoints: bullets("indica-labs", [
      "Designed and implemented a hierarchical selection modal component for file browsing and organization personnel.",
      "Architected the foundation for connecting ephemeral Redux state, remote OpenSeaDragon image tiles, and TensorFlow.js image channel composition.",
      "Designed and implemented an interface to compose non-visible spectral image channels into single tiles.",
      "Maintained complex data views with AG Grid, a bespoke UI, async cell rendering, and Redux integration.",
    ]),
    tags: ["TypeScript", "TensorflowJS", "AWS", "React", "Redux"],
  },
]

const projects = [
  {
    id: "nixos-homelab",
    title: "NixOS declarative homelab with Grafana, OpenTelemetry, and Prometheus",
    description:
      "NixOS infrastructure and TypeScript full stack applications powering my homelab servers, observability stack, certificate authority, and SSO with OIDC.",
    githubLink: "https://github.com/rae-hill",
    tags: [
      "Nix",
      "NixOS",
      "System Administration",
      "TypeScript",
      "Effect",
      "Observability",
      "Grafana",
      "Prometheus",
      "OpenTelemetry",
      "Grafana Tempo",
      "Hardware",
      "Recursive DNS",
      "VPS",
      "Offsite Backup",
    ],
  },
  {
    id: "schemata-ts",
    title: "Production schema engine using profunctorial projection",
    description:
      "A high-level formulation of arbitrary variance data types using profunctorial composition and typeclass injection.",
    githubLink: "https://github.com/rae-hill/schemata-ts",
    tags: ["TypeScript", "Runtime Validation", "Serializers", "Wire Transcoding"],
  },
  {
    id: "bifold-traverse",
    title: "Traversing biparametric datatypes",
    description: "Performing traversal and folding operations over datatypes with two covariant parameters.",
    githubLink: "https://github.com/rae-hill/bifold-traverse",
    tags: [
      "TypeScript",
      "Functional Programming",
      "Category Theory",
      "Combinator TypeClasses",
    ],
  },
  {
    id: "matrix-ts",
    title: "Numerical linear algebra and matrix operations",
    description:
      "A library providing common matrix operations, projections, decompositions, and group-theoretic typeclass instances based on the stellar book for numerical linear algebra: Fundamentals of Matrix Computation (Watkins).",
    githubLink: "https://github.com/rae-hill/matrix-ts",
    tags: [
      "TypeScript",
      "Mathematics",
      "Numerical Linear Algebra",
      "Group Theory",
      "Typeclasses",
    ],
  },
]

/** The default content state — lifted from `packages/resume/src/state/print-config/content-defaults.ts`,
 * extended with blurb and aboutMe defaults. */
export const INITIAL_CONTENT_STATE: ContentState = {
  blurb: BLURB_DEFAULT,
  aboutMe: ABOUT_ME_DEFAULT,
  experience,
  projects,
  skills: ["Foo", "Bar"],
}
