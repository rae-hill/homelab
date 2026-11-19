// Cover-letter template — letterloom layout adapted from the owner's SailPoint letter
// (docs/cover-letter-generator/02-typst-rendering.md §B).
//
// Variable content arrives via the shadow-mapped "letter.json" data file (workspace-
// relative, resolved from the compiler's workspace = the typst assets dir):
//   { toName: string, subject: string, paragraphs: [string] }
// Strings joined into content are LITERAL text in Typst — model-generated `#`, `*`,
// `$`, `@` etc. are inert (CL-D10). The signature image lives at "images/signature.PNG".
#import "@preview/letterloom:3.0.0": *

#let data = json("letter.json")

#show: letterloom.with(
  // Sender's contact information (name and address)
  from-name: "Rae Hill (she/her)",
  from-address: [
    engineer\@rae-hill.dev \
    (505) 290-3096 \
    2794 Barnstormer St. \
    Fort Collins, CO 80524
  ],

  // Recipient's contact information. Street addresses are unknown for online
  // listings, so "to-address" is removed from required-fields (letterloom
  // treats removed fields as absent — src/lib.typ `opt()`).
  to-name: data.toName,
  required-fields: (
    "from-name",
    "from-address",
    "to-name",
    "date",
    "salutation",
    "subject",
    "closing",
    "signatures",
  ),

  // Letter date (automatically set to today's date)
  date: datetime.today().display("[day padding:zero] [month repr:long] [year repr:full]"),

  // Opening greeting
  salutation: "Recruitment, HR, or other esteemed prospective colleague",

  // Letter subject line
  subject: text(weight: "bold")[Regarding the #data.subject],

  // Closing phrase
  closing: "Regards,",

  // List of signatures — add name, optional image, and optional affiliation
  signatures: (
    (
      name: "Rae Hill",
      signature: image("../images/signature.PNG", width: 5cm),
    ),
  ),

  footer: (
    footer-text: text(size: 0.75em)[Made with Typst],
    footer-type: "string",
  ),
)

// Letter body — generated paragraphs, one Typst paragraph each. The loop body is a
// MARKUP block ([...]) so `#p` joins the string as literal text (never re-parsed).
#for p in data.paragraphs [
  #p
  #parbreak()
]
