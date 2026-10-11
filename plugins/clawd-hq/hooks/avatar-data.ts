// Generated from docs/avatars/parts.json (the approved avatar parts), embedded because the plugin cannot read docs/ at run time.
// Every part is rows of characters, one per pixel, placed with its top-left corner at (x, y); '.' is empty and any other character is a palette key.

export type Part = { x: number; y: number; rows: string[] }
export type Character = {
  id: string
  label: string
  short: string
  outfit: string
  headwear: string
  prop: string
  emblem: string
  expression: string
  compactAccent: string
}

const part = (x: number, y: number, ...rows: string[]): Part => ({ x, y, rows })

export const GRID = { width: 24, height: 24 } as const
export const COMPACT_GRID = { width: 16, height: 12 } as const
export const LAYER_ORDER = ["outfit", "emblem", "expression", "headwear", "prop"] as const

export const PALETTE: Record<string, string> = {"o": "#D97757", "d": "#B85C3E", "k": "#1F1B18", "w": "#FFFFFF", "g": "#A9A294", "s": "#8A93A6", "m": "#5A5A66", "n": "#2F4A7A", "b": "#4A8FE0", "c": "#2FA8A0", "e": "#4CAF6A", "y": "#F2C230", "r": "#D64545", "p": "#8A5CD6", "t": "#8B5A2B"}

export const BODY: Part = part(0, 9, "...oooooooooooooo.......", "...oooooooooooooo.......", "...oooooooooooooo.......", "...oooooooooooooo.......", ".oooooooooooooooooo.....", ".oooooooooooooooooo.....", ".ddoooooooooooooodd.....", "...oooooooooooooo.......", "...oooooooooooooo.......", "...oooooooooooooo.......", "...dddddddddddddd.......", "....oo.dd..dd.oo........", "....oo.dd..dd.oo........", "....oo.dd..dd.oo........")

export const PARTS: Record<string, Record<string, Part>> = {
  outfit: {
    "blazer_navy": part(1, 13, ".n..............n.", ".nnnnnnwwwwnnnnnn.", ".nnnnnnwyywnnnnnn.", "..nnnnnnnnnnnnnn..", "..nnnnnnnnnnnnnn..", "..nnnnnnnnnnnnnn..", "..nnnnnnnnnnnnnn.."),
    "vest_blue": part(3, 14, "bbbbbb..bbbbbb", "bbbbbbbbbbbbbb", "bbbbbbbbbbbbbb", "bbbbbbbbbbbbbb", "bbbbbbbbbbbbbb", "bbbbbbbbbbbbbb"),
    "cardigan_teal": part(3, 15, "cccccwwwwccccc", "cccccccccccccc", "cccccccccccccc", "cccccccccccccc", "cccccccccccccc"),
    "lab_coat": part(1, 13, ".w..............w.", ".wwwwwwgoogwwwwww.", ".gwwwwwwggwwwwwwg.", "..gwwwwwgwwwwwwg..", "..gwwwwwgwwwwwwg..", "..gwwwwwgwwwwwwg..", "..gggggggggggggg.."),
    "uniform_charcoal": part(1, 13, ".m..............m.", ".mmmmmmmoommmmmmm.", ".mmmmmmmmmmmmmmmm.", "..mmmmmmmmmmmmmm..", "..mmmmmmmmmmmmmm..", "..mmmmmmyymmmmmm..", "..mmmmmmmmmmmmmm.."),
    "hoodie_steel": part(1, 13, ".s..............s.", ".ssssssssssssssss.", ".ssssssssssssssss.", "..ssssssssssssss..", "..ssssssssssssss..", "..ssssssssssssss..", "..ssssssssssssss.."),
    "sailor_stripes": part(3, 14, "wwwwwwwwwwwwww", "nnnnnnnnnnnnnn", "wwwwwwwwwwwwww", "nnnnnnnnnnnnnn", "wwwwwwwwwwwwww", "nnnnnnnnnnnnnn"),
    "singlet_yellow": part(3, 14, "..yy......yy..", "yyyyyyyyyyyyyy", "yyyyyyyyyyyyyy", "yyyyyyyyyyyyyy", "yyyyyyyyyyyyyy", "yyyyyyyyyyyyyy"),
    "vest_brown": part(3, 15, "tttttt..tttttt", "tttttttttttttt", "tttttttttttttt", "tttttttttttttt", "tttttttttttttt"),
    "overalls_blue": part(3, 14, "..bb......bb..", "..bb......bb..", "..ybbbbbbbby..", "bbbbbbbbbbbbbb", "bbbbbbbbbbbbbb", "bbbbbbbbbbbbbb"),
    "hoodie_purple": part(1, 13, ".p..............p.", ".ppppppp..ppppppp.", ".pppppppppppppppp.", "..pppppppppppppp..", "..pppppppppppppp..", "..pppppppppppppp..", "..pppppppppppppp.."),
    "tunic_green": part(3, 14, "eeeeee..eeeeee", "eeeeeeeeeeeeee", "eeeeeeeeeeeeee", "eeeeeeeeeeeeee", "eeeeeeeeeeeeee", "eeeeeeeeeeeeee"),
    "trench_brown": part(1, 13, ".t..............t.", ".ttttttt..ttttttt.", ".tttttttttttttttt.", "..tttttttttttttt..", "..tttttttttttttt..", "..tttttttttttttt..", "..tttttttttttttt.."),
    "turtleneck_charcoal": part(1, 13, ".m..............m.", ".mmmmmmmmmmmmmmmm.", ".mmmmmmmmmmmmmmmm.", "..mmmmmmmmmmmmmm..", "..mmmmmmmmmmmmmm..", "..mmmmmmmmmmmmmm..", "..mmmmmmmmmmmmmm.."),
    "robe_navy": part(1, 13, ".n..............n.", ".nnnnnnnnnnnnnnnn.", ".nnnnnnnnnnnnnnnn.", "..nnnnnnnnnnnnnn..", "..nnnnnnnnnnnnnn..", "..nnnnnnnnnnnnnn..", "..nnnnnnnnnnnnnn.."),
    "shirt_vest_steel": part(1, 13, ".w..............w.", ".wssssswwwwsssssw.", ".wssssssssssssssw.", "..ssssssssssssss..", "..ssssssssssssss..", "..ssssssssssssss..", "..ssssssssssssss.."),
    "tee_teal": part(3, 14, "cccccc..cccccc", "cccccccccccccc", "cccccccccccccc", "cccccccccccccc", "cccccccccccccc", "cccccccccccccc"),
  },
  emblem: {
    "star_gold": part(4, 16, "..y..", "yyyyy", ".yyy.", ".y.y."),
    "code_brackets": part(6, 16, ".w....w.", "w......w", ".w....w."),
    "red_green": part(10, 16, "rr.ee", "rr.ee"),
    "padlock": part(4, 14, ".yy.", "y..y", "yyyy", "yyyy"),
    "table_grid": part(7, 14, "bbbbb", "w.w.w", "wwwww", "w.w.w", "wwwww"),
    "neckerchief": part(8, 14, "rrrr", ".rr."),
    "bib_play": part(7, 15, "wwwwww", "wwewww", "wweeww", "wwewww", "wwwwww"),
    "page_icon": part(10, 15, "wwww", "wkkw", "wwww", "wkkw", "wwww"),
    "speech_bubble": part(6, 15, "wwwwwww", "wkwkwkw", "wwwwwww", ".ww...."),
    "bullseye": part(7, 14, ".rrr.", "rwwwr", "rwrwr", "rwwwr", ".rrr."),
    "question_mark": part(7, 14, ".www.", "ww.ww", "...ww", "..ww.", ".....", "..ww."),
    "quote_marks": part(6, 15, ".ww..ww", "ww..ww.", "www.www", "www.www"),
    "jabot": part(8, 14, "wwww", "wwww", "w..w", "w..w"),
    "equals": part(7, 16, "yyyyy", ".....", "yyyyy"),
    "bars_up": part(6, 15, "......ww", "...ww.ww", "ww.ww.ww", "ww.ww.ww"),
    "steps": part(7, 16, "....ww", "..wwww", "wwwwww"),
    "error_label": part(7, 16, "wwwww", "wrwrw", "wwrww", "wrwrw"),
  },
  expression: {
    "neutral": part(4, 10, "............", "..kk....kk..", "..kk....kk..", "..kk....kk.."),
    "focused": part(4, 10, ".kkkk..kkkk.", "............", "..kk....kk..", "..kk....kk.."),
    "stern": part(4, 10, ".kk......kk.", "...kk..kk...", "..kk....kk..", "..kk....kk.."),
    "happy": part(4, 10, "............", "..kk....kk..", ".k..k..k..k.", "............"),
    "sparkle": part(4, 10, "............", "..wk....wk..", "..kk....kk..", "..kk....kk.."),
    "wink": part(4, 10, "............", "..kk........", "..kk...kkkk.", "..kk........"),
    "glasses": part(3, 10, ".kkkkk..kkkkk.", "kkwkwkkkkwkwkk", ".kwkwk..kwkwk.", ".kkkkk..kkkkk."),
    "sweat": part(4, 10, "...........b", "..kk....kk.b", "..kk....kk..", "..kk....kk.."),
  },
  headwear: {
    "crown_gold": part(5, 5, "y...yy...y", "yy.yyyy.yy", "yyyyyyyyyy", "ynyynnyyny"),
    "pencil_ear": part(2, 6, "..dyyyyyyyyywrr", "kddyyyyyyyyywrr", "..dyyyyyyyyywrr"),
    "deerstalker": part(2, 4, "......dddd......", "....tdtdtdtd....", "...tdtdtdtdtd...", "..tdtdtdtdtdtd..", "..dtdtdtdtdtdt..", "dddddddddddddddd"),
    "goggles_up": part(3, 6, "..ggg....ggg..", ".gweeggggweeg.", ".geeeggggeeeg.", "gggggggggggggg"),
    "guard_cap": part(2, 3, "..mmmmmmmmmmmm..", ".mmmmmmmmmmmmmm.", ".mmmmmmyymmmmmm.", "..mmmmmyymmmmm..", "..mmmmmmmmmmmm..", ".kkkkkkkkkkkkkk."),
    "elephant_hood": part(0, 5, "......ssssssss......", ".sss.ssssssssss.sss.", "ssssssssssssssssssss", "ssssssskssssksssssss", "ssssssssssssssssssss", "sss.....wssw.....sss", "sss......ss......sss", ".ss......ss......ss."),
    "captain_cap": part(2, 4, "..gggggggggggg..", ".gwwwwwwwwwwwwg.", ".gwwwwwyywwwwwg.", "..gwwwwyywwwwg..", "..nnnnnnnnnnnn..", ".nnnnnnnnnnnnnn."),
    "sweatband": part(0, 9, ".rrrrrrrrrrrrrrrr", "rr.rrrrrrrrrrrrrr", "r................"),
    "book_stack": part(4, 2, "..eeeeeeeee.", "..ewwwwwwww.", "..eeeeeeeee.", "rrrrrrrrrrr.", "rwwwwwwwwww.", "rwwwwwwwwww.", "rrrrrrrrrrr."),
    "hardhat_lamp": part(2, 4, "......yyyy......", "....yyyyyyyy....", "...yyyywwyyyy...", "...yyyywwyyyy...", "..yyyyyyyyyyyy..", "yyyyyyyyyyyyyyyy"),
    "headphones": part(1, 7, "...ssssssssssss...", ".ssssssssssssssss.", "sss............sss", "sks............sks", "sks............sks", "sss............sss"),
    "feather_cap": part(1, 3, "............r....", ".......eee.rr....", ".....eeeeeerr....", "....eeeeeeerre...", "...eeeeeeeeeeee..", "eeeeeeeeeeeeeeee."),
    "flame": part(5, 1, "....r.....", "...rr..r..", "..rrr.rr..", "..rryrrr..", ".rryyyrrr.", ".ryyyyyrr.", "rryyyyyyrr", "rryyyyyyrr"),
    "beret": part(1, 5, "...........p....", ".....ppppppppp..", "..ppppppppppppp.", ".pppppppppppppp.", "..pppppppppppppp"),
    "barrister_wig": part(2, 5, "....gggggggg....", "..ggwwwwwwwwgg..", ".gwwgwwgwwgwwwg.", ".gwwwwwwwwwwwwg.", ".gwgwwgwwgwwgwg.", "gwg..........gwg", "gww..........wwg", "gwg..........gwg", ".gg..........gg."),
    "arrow_up": part(6, 1, "...ee...", "..eeee..", ".eeeeee.", "eeeeeeee", "..eeee..", "..eeee..", "..eeee..", "..eeee.."),
    "coin_stack": part(5, 2, ".yyyyyy..", "yyywyyyy.", "dddddddd.", ".yyyyyyyy", ".dddddddd", "yyyyyyyy.", "dddddddd."),
  },
  prop: {
    "blueprint": part(17, 8, "wwwwwww", "bbbbbbb", "bwwwbbb", "bbbbbbb", "bbwwwbb", "bbbbbbb", "bbbbwwb", "bbbbbbb", "wwwwwww"),
    "diff_card": part(18, 9, "kkkkkk", "wwwwww", "weeeew", "wwwwww", "wrrrrw", "wwwwww", "weeeww", "wwwwww", "wrrwww", "wwwwww"),
    "test_tube": part(17, 4, "....e..", "..e....", ".......", "ggggggg", ".g...g.", ".g...g.", ".geeeg.", ".geeeg.", ".geeeg.", ".geeeg.", ".geeeg.", "..ggg.."),
    "shield": part(17, 9, "bbbbbbb", "bbbbbwb", "bbbbwbb", "bwbwbbb", "bbwbbbb", ".bbbbb.", "..bbb..", "...b..."),
    "db_cylinder": part(18, 11, ".bbbb.", "bwwwwb", "bbbbbb", "bbbbbb", "nbbbbn", "bnnnnb", "bbbbbb", "nbbbbn", "bnnnnb", "bbbbbb", ".bbbb."),
    "containers": part(18, 9, "rrrrrr", "rwrwrw", "rwrwrw", "rrrrrr", "nnnnnn", "nwnwnw", "nwnwnw", "nnnnnn"),
    "browser_window": part(17, 8, "sssssss", "sryesss", "sssssss", "swwwwws", "swkwwws", "swkkwws", "swkkkws", "swkwwws", "swwwwws", "sssssss"),
    "pencil_big": part(19, 7, "rrr", "www", "yyy", "yyy", "yyy", "yyy", "yyy", "yyy", "yyy", "ttt", ".k."),
    "wrench": part(18, 5, "ss..ss", "ss..ss", "ssssss", ".ssss.", "..ss..", "..ss..", "..ss..", "..ss..", "..ss..", ".ssss.", ".s..s.", ".ssss."),
    "calendar": part(15, 12, "rrrrrrrrr", "rrrrrrrrr", "wkkkwkkkw", "wwwkwkwkw", "wwkkwkwkw", "wwwkwkwkw", "wkkkwkkkw", "wwwwwwwww"),
    "arrow": part(18, 3, "..s..", ".sss.", ".sss.", "sssss", "..t..", "..t..", "..t..", "..t..", "..t..", "..t..", "..t..", "..t..", "r.t.r", "rrtrr", "r.t.r"),
    "microphone": part(18, 6, ".sss.", "swsss", "sssss", "sssss", ".sss.", "..s..", ".sss.", ".sss.", ".sss.", ".sss."),
    "megaphone": part(17, 7, ".....rr", "...rrrr", ".wrrrrr", "rwrrrrr", "rwrrrrr", ".wrrrrr", "...rrrr", "..mm.rr", "..mm..."),
    "contract_scroll": part(18, 8, "gggggg", "gwwwwg", "gkkkkg", "gwwwwg", "gkkkkg", "gwwwwg", "gkkwwg", "gwwrrg", "gwwrrg", "gggggg"),
    "calculator": part(17, 9, "mmmmmmm", "meeeeem", "meeeeem", "mmmmmmm", "mwmwmwm", "mmmmmmm", "mwmwmwm", "mmmmmmm", "mwmwmym", "mmmmmmm"),
    "magnifier": part(17, 5, "..ssss.", ".sw...s", ".s....s", ".s....s", ".s....s", "..ssss.", "..tt...", ".tt....", ".t....."),
    "logbook": part(17, 9, "..yyy..", "ttttttt", "twwwwwt", "tewkkwt", "twwwwwt", "tewkkwt", "twwwwwt", "tewkkwt", "twwwwwt", "ttttttt"),
  },
}

// Not in parts.json: Clawd's blink, the neutral eyes squashed to one row. Added here so the designer's parts.json can match.
export const BLINK: Part = part(4, 10, "............", "............", "..kk....kk..", "............")

export const COMPACT: { body: Part; headwear: Record<string, Part>; accent: Record<string, Part> } = {
  body: part(0, 4, "...oooooooooo...", "...ookooookoo...", "..oookooookooo..", "..oooooooooooo..", "...dddddddddd...", "....o.d..d.o....", "....o.d..d.o...."),
  headwear: {
    "crown_gold": part(4, 1, "y..yy..y", "yyyyyyyy", "ynyyyyny"),
    "pencil_ear": part(3, 2, ".dyyyyywrr", "kdyyyyywrr"),
    "deerstalker": part(2, 1, ".....dd.....", "...tdtdtd...", "..tdtdtdtd..", "dddddddddddd"),
    "goggles_up": part(3, 2, ".ggg..ggg.", "geeeggeeeg", "gggggggggg"),
    "guard_cap": part(3, 1, ".mmmmmmmm.", "mmmmyymmmm", ".mmmmmmmm.", "kkkkkkkkkk"),
    "elephant_hood": part(0, 2, "....ssssssss....", ".ssssssssssssss.", "ssssssssssssssss", "sss....ss....sss", ".s.....ss.....s."),
    "captain_cap": part(3, 1, ".wwwwwwww.", "wwwwyywwww", "nnnnnnnnnn", "nnnnnnnnnn"),
    "sweatband": part(1, 4, ".rrrrrrrrrrr", "r..........."),
    "book_stack": part(4, 0, ".eeeeee.", ".eewwww.", "rrrrrrrr", "rrwwwwww"),
    "hardhat_lamp": part(2, 1, "....yyyy....", "..yyywwyyy..", "..yyyyyyyy..", "yyyyyyyyyyyy"),
    "headphones": part(1, 2, "...ssssssss...", ".ssssssssssss.", "ss..........ss", "ss..........ss", "ss..........ss"),
    "feather_cap": part(1, 0, ".........r...", "....eeeerr...", "...eeeeeer...", "eeeeeeeeeeee."),
    "flame": part(5, 0, "..r...", ".rr.r.", ".ryrr.", "rryyrr"),
    "beret": part(2, 1, "........p...", "...pppppppp.", ".ppppppppppp", ".pppppppppp."),
    "barrister_wig": part(2, 1, "..gwwwwwwg..", ".gwwgwwgwwg.", "gwwwwwwwwwwg", "gw........wg", "gw........wg", ".g........g."),
    "arrow_up": part(5, 0, "..ee..", ".eeee.", "eeeeee", "..ee.."),
    "coin_stack": part(5, 0, ".yyyy.", "yyyyyy", "dddddd", "yyyyyy"),
  },
  accent: {
    "blueprint": part(13, 5, "bbb", "bww", "bbb", "wwb", "bbb"),
    "diff_card": part(13, 5, "www", "wee", "www", "wrr", "www"),
    "test_tube": part(13, 4, "ggg", "g.g", "geg", "geg", "ggg"),
    "shield": part(13, 5, "bbb", "bwb", "bbb", ".b."),
    "db_cylinder": part(13, 6, "bbb", "www", "bbb", "nnn", "bbb"),
    "containers": part(13, 5, "rrr", "rrr", "nnn", "nnn"),
    "bib_band": part(3, 7, "yyywwwwyyy", "yyywwwwyyy"),
    "pencil_big": part(14, 3, "rr", "yy", "yy", "yy", "yy", "tt"),
    "wrench": part(13, 3, "s.s", "sss", ".s.", ".s.", ".s."),
    "calendar": part(13, 7, "rrr", "www", "wkw", "www"),
    "arrow": part(13, 2, ".s.", "sss", ".t.", ".t.", ".t.", "rtr"),
    "microphone": part(13, 3, "sss", "sss", ".s.", ".s."),
    "megaphone": part(13, 4, "..r", "wrr", "wrr", "..r"),
    "contract_scroll": part(13, 7, "ggg", "gkg", "ggr"),
    "calculator": part(13, 5, "mmm", "mem", "mmm", "mwm", "mmm"),
    "magnifier": part(13, 4, "sss", "s.s", "sss", "t.."),
    "logbook": part(13, 5, "tyt", "twt", "tet", "twt", "ttt"),
  },
}

export const CHARACTERS: Character[] = [
  { id: "clawd", label: "Clawd (chief of staff)", short: "Clawd", outfit: "blazer_navy", headwear: "crown_gold", prop: "logbook", emblem: "star_gold", expression: "neutral", compactAccent: "logbook" },
  { id: "ecc:planner", label: "ecc:planner", short: "planner", outfit: "vest_blue", headwear: "pencil_ear", prop: "blueprint", emblem: "steps", expression: "focused", compactAccent: "blueprint" },
  { id: "ecc:code-reviewer", label: "ecc:code-reviewer", short: "code-review", outfit: "cardigan_teal", headwear: "deerstalker", prop: "diff_card", emblem: "code_brackets", expression: "glasses", compactAccent: "diff_card" },
  { id: "ecc:tdd-guide", label: "ecc:tdd-guide", short: "tdd-guide", outfit: "lab_coat", headwear: "goggles_up", prop: "test_tube", emblem: "red_green", expression: "neutral", compactAccent: "test_tube" },
  { id: "ecc:security-reviewer", label: "ecc:security-reviewer", short: "security", outfit: "uniform_charcoal", headwear: "guard_cap", prop: "shield", emblem: "padlock", expression: "stern", compactAccent: "shield" },
  { id: "ecc:database-reviewer", label: "ecc:database-reviewer", short: "database", outfit: "hoodie_steel", headwear: "elephant_hood", prop: "db_cylinder", emblem: "table_grid", expression: "sparkle", compactAccent: "db_cylinder" },
  { id: "ecc:docker-patterns", label: "ecc:docker-patterns", short: "docker", outfit: "sailor_stripes", headwear: "captain_cap", prop: "containers", emblem: "neckerchief", expression: "happy", compactAccent: "containers" },
  { id: "ecc:e2e-runner", label: "ecc:e2e-runner", short: "e2e-runner", outfit: "singlet_yellow", headwear: "sweatband", prop: "browser_window", emblem: "bib_play", expression: "neutral", compactAccent: "bib_band" },
  { id: "ecc:doc-updater", label: "ecc:doc-updater", short: "doc-updater", outfit: "vest_brown", headwear: "book_stack", prop: "pencil_big", emblem: "page_icon", expression: "glasses", compactAccent: "pencil_big" },
  { id: "ecc:build-error-resolver", label: "ecc:build-error-resolver", short: "build-fix", outfit: "overalls_blue", headwear: "hardhat_lamp", prop: "wrench", emblem: "error_label", expression: "sweat", compactAccent: "wrench" },
  { id: "last30days", label: "last30days", short: "last30days", outfit: "hoodie_purple", headwear: "headphones", prop: "calendar", emblem: "speech_bubble", expression: "sparkle", compactAccent: "calendar" },
  { id: "get-to-the-point", label: "get-to-the-point", short: "to-the-point", outfit: "tunic_green", headwear: "feather_cap", prop: "arrow", emblem: "bullseye", expression: "wink", compactAccent: "arrow" },
  { id: "grill-me", label: "grill-me", short: "grill-me", outfit: "trench_brown", headwear: "flame", prop: "microphone", emblem: "question_mark", expression: "stern", compactAccent: "microphone" },
  { id: "copywriting", label: "copywriting", short: "copywriting", outfit: "turtleneck_charcoal", headwear: "beret", prop: "megaphone", emblem: "quote_marks", expression: "happy", compactAccent: "megaphone" },
  { id: "legal:review-contract", label: "legal:review-contract", short: "contract", outfit: "robe_navy", headwear: "barrister_wig", prop: "contract_scroll", emblem: "jabot", expression: "focused", compactAccent: "contract_scroll" },
  { id: "finance:reconciliation", label: "finance:reconciliation", short: "reconcile", outfit: "shirt_vest_steel", headwear: "coin_stack", prop: "calculator", emblem: "equals", expression: "focused", compactAccent: "calculator" },
  { id: "marketing:seo-audit", label: "marketing:seo-audit", short: "seo-audit", outfit: "tee_teal", headwear: "arrow_up", prop: "magnifier", emblem: "bars_up", expression: "happy", compactAccent: "magnifier" },
]
