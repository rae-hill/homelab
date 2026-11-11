import type { IconType } from "react-icons"
import { SiTypescript } from "react-icons/si"
import { VscGithub } from "react-icons/vsc"

export interface ExperienceEntry {
  readonly company: string
  readonly roles: ReadonlyArray<{
    readonly date: string
    readonly title: string
  }>
  readonly location: string
  readonly description: string
  readonly bulletPoints?: ReadonlyArray<string>
  readonly tags: ReadonlyArray<string>
}

export const experiences: ReadonlyArray<ExperienceEntry> = [
  {
    company: "Nutrien (P3-Uplift)",
    roles: [
      {
        title: "Senior Software Engineer",
        date: "June 2025 – June 2026",
      },
    ],
    location: "Loveland, CO (Remote)",
    description:
      `Spearheaded a production support-tool microfrontend and deployed synchronization infrastructure and services that bridged internal and partner data sources via async pipelines. Provided L3 support and database analytics for production ERPs and connected systems.`,
    bulletPoints: [
      "Architected ETL async data-pipeline lambdas and infrastructure that consumed partner Kafka streams (AWS MSK + SQS) and services for synchronizing PostGIS data for high-resolution spatial boundaries.",
      "Spearheaded an internal React microfrontend support-tool with SSO/OIDC authentication, cutting L2/L3 ticket resolution-time from weeks to hours.",
      "Authored GraphQL schemas, resolvers, and SQL queries for production ERPs and federated Apollo graphs.",
      "Provided on-call L3 support, database analytics, reporting, and observability for production enterprise resources.",
    ],
    tags: [
      "TypeScript",
      "Lambda",
      "React",
      "RTK",
      "MUI",
      "MSK",
      "GraphQL",
      "OAuth2",
      "OIDC",
      "PostgreSQL",
      "SQL",
      "Liquibase",
      "Prisma",
      "ReBAC",
      "RBAC",
      "CloudWatch",
      "PagerDuty",
      "AWS CDK",
      "ETL",
      "Microservices",
      "Kiro",
      "GitHub Copilot",
    ].sort(),
  },
  {
    company: "Shutterfly (Spoonflower)",
    roles: [
      {
        title: "Senior Software Engineer II",
        date: "July 2022 – March 2025",
      },
    ],
    location: "Durham, NC (Remote)",
    description:
      `Led the authentication replatforming initiative, migrated to AWS WAF Captcha, integrated with a partner tax platform for federal withholdings and royalties, and redesigned the entire artist marketplace experience from scratch.`,
    bulletPoints: [
      "Engineered a high-performance hybrid SSR server serving over 600,000 requests daily; deeply introspected with Open Telemetry (OTel)",
      "Retrofitted legacy codebases with a new W9 and W8 tax document vendor, saving thousands of personnel hours in manual document collation.",
      "Architected an OAuth 2.0 backwards compatible authentication system powered by Cognito, paving the way for future replatforming and increased security throughout the site.",
      "Maintained a legacy Ruby on Rails codebase gradually transitioning to NodeJS microservices.",
    ],
    tags: [
      "TypeScript",
      "Python",
      "Ruby",
      "Rails",
      "fp-ts",
      "fastify",
      "NextJS",
      "React",
      "ReBAC",
      "RBAC",
      "Chakra-UI",
      "Cypress",
      "Splunk",
      "OAuth2",
      "OIDC",
      "EKS",
      "Kubernetes",
      "Docker",
      "Microservices",
      "Terraform",
      "GitHub Copilot",
    ].sort(),
  },
  {
    company: "SimSpace",
    roles: [
      {
        title: "Software Engineer II",
        date: "March 2021 – July 2022",
      },
    ],
    location: "Boston, MA (Remote)",
    description:
      `Engineered a sophisticated quotas management UI to design specifications and analyzed Kubernetes system performance using a NodeJS-based browser emulation platform.`,
    bulletPoints: [
      "Engineered VM interface load testing suites to benchmark critical virtual environment performance.",
      "Implemented sophisticated UI for managing an organization's VM resource availability, allocation, and access.",
    ],
    tags: [
      "TypeScript",
      "Haskell",
      "Nix",
      "React",
      "Redux",
      "RTK",
      "MUI",
      "RxJS",
      "K6",
      "Kubernetes",
      "Microservices",
      "Puppeteer",
    ].sort(),
  },
  {
    company: "Electronic Caregiver",
    roles: [
      {
        title: "Software Engineer, Team Lead",
        date: "November 2019 – March 2021",
      },
    ],
    description:
      `Integrated with partner peripherals using Web-Bluetooth, solved WebGL rendering anomalies, and engineered a patient management portal for care providers.`,
    location: "Las Cruces, NM",
    bulletPoints: [
      "Corrected complex temporal WebGL rendering bugs with Addison, a virtual care assistant.",
      "Tech lead for a pandemic symptom-checker app with Bluetooth peripheral integration.",
    ],
    tags: [
      "TypeScript",
      "Python",
      "WebGL",
      "React",
      "Redux",
      "RxJS",
      "NestJS",
      "TypeORM",
    ].sort(),
  },
  {
    company: "Indica Labs",
    roles: [
      {
        title: "Software Developer",
        date: "May 2019 – August 2019",
      },
    ],
    location: "Albuquerque, NM",
    description:
      `Engineered an arbitrarily deep file selector, and used tensorflow for image manipulation in real time.`,
    bulletPoints: [
      "Implemented a file picker aware of user permissions and scope that could nest deeply.",
      "Adopted TensorflowJS for projecting multi-band cell stains into visual spectra in real-time.",
    ],
    tags: ["TypeScript", "React", "Redux", "TensorflowJS", "MUI", "SUI"].sort(),
  },
]

export interface ProjectEntry {
  readonly title: string
  readonly description: string
  readonly githubLink: string
  readonly icon: IconType
  readonly iconColor: string
  readonly tags: ReadonlyArray<string>
}

export const projects: ReadonlyArray<ProjectEntry> = [
  {
    title: "NixOS Homelab",
    description:
      "NixOS infrastructure and TypeScript full stack applications powering my homelab servers, Grafana/OpenTelemetry/Prometheus observability stack, certificate authority, and SSO with OIDC.",
    githubLink: "https://github.com/rae-hill",
    icon: SiTypescript,
    iconColor: "#3178C6",
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
    ].sort(),
  },
  {
    title: "Production schema engine using profunctorial projection",
    description:
      "A high-level formulation of arbitrary variance data types using profunctorial composition and typeclass injection.",
    githubLink: "https://github.com/rae-hill/schemata-ts",
    icon: SiTypescript,
    iconColor: "#3178C6",
    tags: [
      "TypeScript",
      "Runtime Validation",
      "Serializers",
      "Wire Transcoding",
    ].sort(),
  },
  {
    title: "Traversing biparametric datatypes",
    description: "Performing traversal and folding operations over datatypes with two covariant parameters.",
    githubLink: "https://github.com/rae-hill/bifold-traverse",
    icon: SiTypescript,
    iconColor: "#3178C6",
    tags: [
      "TypeScript",
      "Functional Programming",
      "Category Theory",
      "Combinator TypeClasses",
    ].sort(),
  },
  // {
  //   title: 'Tail recursive monadic design patterns',
  //   description: 'Monadic typeclasses for constructing tail-recursive behaviors.',
  //   githubLink: 'https://github.com/rae-hill/chain-rec',
  //   icon: SiTypescript,
  //   iconColor: '#3178C6',
  //   tags: [
  //     'TypeScript',
  //     'Open-Source Software',
  //     'Category Theory',
  //     'Monads',
  //     'Recursion',
  //   ].sort(),
  // },
  {
    title: "Numerical linear algebra and matrix operations",
    description:
      "A library providing common matrix operations, projections, decompositions, and group-theoretic typeclass instances based on the stellar book for numerical linear algebra: Fundamentals of Matrix Computation (Watkins).",
    githubLink: "https://github.com/rae-hill/matrix-ts",
    icon: SiTypescript,
    iconColor: "#3178C6",
    tags: [
      "TypeScript",
      "Mathematics",
      "Numerical Linear Algebra",
      "Group Theory",
      "Typeclasses",
    ].sort(),
  },
]

export const githubIcon = VscGithub

/** Every tag occurrence across experience entries and projects (with repeats). */
const tagOccurrences: ReadonlyArray<string> = [
  ...experiences.flatMap((experience) => experience.tags),
  ...projects.flatMap((project) => project.tags),
]

/**
 * The union of every tag used across experience entries and projects. Duplicates
 * are collapsed and the result is sorted so downstream consumers (e.g. the tag
 * cloud) receive a stable, deterministic ordering.
 */
export const allTags: ReadonlyArray<string> = Array.from(new Set(tagOccurrences)).sort(
  (a, b) => a.localeCompare(b),
)

/**
 * Map of each unique tag to the number of times it appears across the resume
 * (experience + projects). Consumed by the tag cloud to scale font size by how
 * frequently a skill is referenced.
 */
export const tagFrequency: ReadonlyMap<string, number> = tagOccurrences.reduce(
  (counts, tag) => counts.set(tag, (counts.get(tag) ?? 0) + 1),
  new Map<string, number>(),
)
