// Fixtures for `node scripts/fetch-policies.mjs --mock`, used to exercise the
// parsing / fence-stripping / schema-validation / fallback logic without needing
// a real ANTHROPIC_API_KEY or network access. Not used in production runs.
//
// `libdem` is deliberately malformed (only 5 policies) to prove the fallback path
// works: a bad response must never get written, and the previous month's file
// must be carried forward instead.

const wrap = (obj) => "```json\n" + JSON.stringify(obj, null, 2) + "\n```";

export const mockResponses = {
  labour:
    "I'll search for Labour's current policies.\n\n" +
    wrap({
      party: "Labour Party",
      partyId: "labour",
      asOf: "2026-09-01",
      policies: [
        { id: "labour-01", title: "Kickstart economic growth", statement: "Reform planning rules and back infrastructure to deliver the highest sustained growth in the G7.", sourceUrl: "https://labour.org.uk/plan-for-change/" },
        { id: "labour-02", title: "Clean energy superpower", statement: "Decarbonise the electricity grid through the publicly owned GB Energy to cut bills and boost energy security.", sourceUrl: "https://labour.org.uk/plan-for-change/" },
        { id: "labour-03", title: "Take back our streets", statement: "Fund a Neighbourhood Policing Guarantee with more officers and PCSOs to tackle antisocial behaviour.", sourceUrl: "https://labour.org.uk/plan-for-change/" },
        { id: "labour-04", title: "An NHS fit for the future", statement: "Cut waiting lists and shift more care from hospitals into local communities and digital services.", sourceUrl: "https://labour.org.uk/plan-for-change/" },
        { id: "labour-05", title: "Break down barriers to opportunity", statement: "Expand childcare and breakfast clubs and raise school standards for children from all backgrounds.", sourceUrl: "https://labour.org.uk/plan-for-change/" },
        { id: "labour-06", title: "Secure our borders", statement: "Run a Border Security Command with counter-terrorism-style powers against people-smuggling gangs.", sourceUrl: "https://labour.org.uk/change/my-plan-for-change/" },
      ],
    }),

  conservative: JSON.stringify({
    party: "Conservative Party",
    partyId: "conservative",
    asOf: "2026-09-01",
    policies: [
      { id: "conservative-01", title: "Reform welfare, cut spending", statement: "Find billions in savings by reforming welfare and getting more people back into work.", sourceUrl: "https://www.conservatives.com/our-plan-for-britain" },
      { id: "conservative-02", title: "Scrap the Net Zero target", statement: "Abandon the 2050 Net Zero target and expand North Sea oil and gas licensing to cut energy bills.", sourceUrl: "https://www.conservatives.com/our-plan-for-britain" },
      { id: "conservative-03", title: "Leave the ECHR", statement: "Leave the European Convention on Human Rights to enable faster removals of people with no right to stay.", sourceUrl: "https://www.conservatives.com/our-plan-for-britain" },
      { id: "conservative-04", title: "Cut property and business taxes", statement: "Abolish stamp duty on primary homes and scrap business rates to support ownership and high streets.", sourceUrl: "https://www.conservatives.com/our-plan-for-britain" },
      { id: "conservative-05", title: "Tougher policing and sentencing", statement: "Put more police into high-crime areas and roll out facial recognition and swifter community sentencing.", sourceUrl: "https://www.conservatives.com/our-plan-for-britain" },
      { id: "conservative-06", title: "Protect core public services", statement: "Ban smartphones in schools and legislate minimum NHS service levels during industrial action.", sourceUrl: "https://www.conservatives.com/our-plan-for-britain" },
    ],
  }),

  reform: wrap({
    party: "Reform UK",
    partyId: "reform",
    asOf: "2026-09-01",
    policies: [
      { id: "reform-01", title: "Stop the boats", statement: "Deploy the armed forces to intercept and stop illegal Channel crossings before they land.", sourceUrl: "https://www.reformparty.uk/policies" },
      { id: "reform-02", title: "Mass deportation programme", statement: "Leave the ECHR and run a multi-year programme to detain and deport people with no right to remain.", sourceUrl: "https://www.reformparty.uk/policies" },
      { id: "reform-03", title: "Scrap indefinite leave to remain", statement: "Replace long-term visa routes with renewable visas requiring a higher salary and fluent English.", sourceUrl: "https://www.reformparty.uk/policies" },
      { id: "reform-04", title: "Scrap Net Zero policies", statement: "Expand domestic energy production and cut household bills by dropping Net Zero commitments.", sourceUrl: "https://www.reformparty.uk/policies" },
      { id: "reform-05", title: "Make work pay", statement: "Cut taxes on workers' pay and restructure welfare so work always pays more than benefits.", sourceUrl: "https://www.reformparty.uk/policies" },
      { id: "reform-06", title: "Restore British sovereignty", statement: "Ensure British law and courts take precedence over foreign courts in domestic decisions.", sourceUrl: "https://www.reformparty.uk/policies" },
    ],
  }),

  // Deliberately broken: only 5 policies (schema requires exactly 6). This should
  // cause fetch-policies.mjs to reject it and fall back to the previous month's file.
  libdem: wrap({
    party: "Liberal Democrats",
    partyId: "libdem",
    asOf: "2026-09-01",
    policies: [
      { id: "libdem-01", title: "A new Department for Growth Creation", statement: "Replace the Treasury with a new department, based outside London, focused on long-term growth.", sourceUrl: "https://www.libdems.org.uk/news/article/get-britain-growing-again" },
      { id: "libdem-02", title: "Closer trade ties with Europe", statement: "Negotiate a better UK-EU trading relationship to cut red tape and raise money for public services.", sourceUrl: "https://www.libdems.org.uk/news/article/get-britain-growing-again" },
      { id: "libdem-03", title: "Fix the social care crisis", statement: "Introduce free personal care for older and disabled people through a cross-party settlement.", sourceUrl: "https://www.libdems.org.uk/" },
      { id: "libdem-04", title: "Proportional representation", statement: "Replace first-past-the-post with a proportional voting system for Westminster elections.", sourceUrl: "https://www.libdems.org.uk/" },
      { id: "libdem-05", title: "Stop sewage dumping", statement: "Impose automatic fines on water companies that dump sewage into rivers and seas.", sourceUrl: "https://www.libdems.org.uk/" },
    ],
  }),

  green: JSON.stringify({
    party: "Green Party",
    partyId: "green",
    asOf: "2026-09-01",
    policies: [
      { id: "green-01", title: "Public ownership of water", statement: "Bring water companies into public ownership to end privatisation failures and stop sewage dumping.", sourceUrl: "https://policy.greenparty.org.uk/" },
      { id: "green-02", title: "A wealth tax on the very richest", statement: "Introduce an annual wealth tax on assets over ten million pounds to fund public services.", sourceUrl: "https://policy.greenparty.org.uk/" },
      { id: "green-03", title: "Rent controls and a rent freeze", statement: "Freeze rents for a year and introduce permanent rent controls with stronger renter protections.", sourceUrl: "https://policy.greenparty.org.uk/" },
      { id: "green-04", title: "Proportional representation and workers' rights", statement: "Introduce proportional representation and a Workers' Charter with stronger day-one employment rights.", sourceUrl: "https://policy.greenparty.org.uk/" },
      { id: "green-05", title: "Rapid shift to renewable energy", statement: "Accelerate the switch to renewables and fund large-scale nature and river restoration.", sourceUrl: "https://policy.greenparty.org.uk/" },
      { id: "green-06", title: "Cheaper, greener transport", statement: "Increase bus funding and cut motorway speed limits to reduce transport costs and emissions.", sourceUrl: "https://policy.greenparty.org.uk/" },
    ],
  }),
};
