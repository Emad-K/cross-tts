/**
 * Phonon 31M (gradium/phonon-31m-en, Apache-2.0) and its preset voices
 * (gradium/phonon-voices, Apache-2.0), pinned to commits. Phonon builds on
 * Kyutai's Pocket TTS and the Mimi codec. It runs in the renderer on the
 * official phonon-tts WebAssembly runtime; there is no complete ONNX export
 * (the only one, phonon-31m-en-compute-flow, keeps the flow LM as GGUF and
 * Mimi as TFLite).
 */

export const PHONON_REPO = "gradium/phonon-31m-en";
/** `main` as of 2026-11-17. Bump together with PHONON_SHA256. */
export const PHONON_REVISION = "8f7a37c94a4c58b04c8287300c53f11d2e208eae";
export const PHONON_WEIGHTS = "model.q8.gguf";

/** sha256 (HF LFS oid at PHONON_REVISION) of every weight file the app loads. */
export const PHONON_SHA256: Readonly<Record<string, string>> = {
	"model.q8.gguf":
		"a7d9aad2cd6dc66473f24a08bc6d2939030ef4d751ef82349361fbef3272dbae",
};

export const PHONON_VOICES_REPO = "gradium/phonon-voices";
/** `main` as of 2026-10-20. */
export const PHONON_VOICES_REVISION = "0ee17205f254b5abc43b266c8a0f215565c352f7";

/**
 * The English voices of PHONON_VOICES_REPO's voices.jsonl:
 * [voice_id, name, locale ("en" for the character voices), sha256 of
 * `voices/<voice_id>.safetensors`].
 */
export const PHONON_VOICES: readonly (readonly [string, string, string, string])[] = [
	["NbpkqMVS3CJeq2j8", "Zoey", "en-us", "97c7f8c253413574406ab80dd23f49c3ebb2517163b00a9bf86b9c4cf43e7e23"],
	["NIWIOv5vTi5eRMj8", "Juniper", "en-us", "444378eb06b7c492b86e8fc7d13e4db1a3c0cf3e68891a960bf6f0a41a13ef35"],
	["vjFyp2BcCyTlUmYb", "Everly", "en-us", "958ea94da14f46dd48c7f64adac11ed2ad2aa45f7ccd165dfebab5272664402e"],
	["4SZHfMpw-p46Ywgs", "Harper", "en-us", "6b3da6e2d796a20c51af892c482bd6509fb88267a221aff83c870843dee2a123"],
	["bXwrkHhURL1VFJdG", "Hadley", "en-us", "a879938aa9a2df0a8220bdadef88137929f71e887bd91e7db205bd5fa11661d2"],
	["nGzMHMPAWGaJFHOo", "Delia", "en-us", "a0c3dcb91b2247eca56536be9ae8e8becc1c807b1136c5fe101552d6a155b24a"],
	["LMDIYE0Oa377Qh6Z", "Easton", "en-us", "45c582673cb20edb04ddcca2b5a8865ddfb0a82599efadb269021e87d20fbdd4"],
	["40QrMVgAxFiUnP9f", "Micah", "en-us", "0de1098d1051686a138d068e83ff09deb5053328bc74ec9541a1fdb90bfc24da"],
	["0zLApsZfVLLNaEGl", "Trevor", "en-us", "dc1341c8937af5534e6bbcc5c0fc5e7c10312229b59061228074f93683fe2261"],
	["_6Aslh2DxfmnRLmP", "Russell", "en-us", "beae9e4030efce0a935fcb0f807dc0784d598bcaa87ad4aacb047436b1eaa411"],
	["qIxlZ7Ei8KvWlyQH", "Preston", "en-us", "6e04b84d3ae8751b22bca0a4f63936f9cb648f4f2182b2d0788071ea1c0b68a1"],
	["d9XCyhjo4JhkHF1d", "Miles", "en-us", "eab20e4f159b48cfbc01b1885804e24f681f80e7a64f909182763a4e3361bee8"],
	["6PWnV0Nq4wu7RVBT", "Maeve", "en-gb", "56494ee67d533ad227ff0dfd0b1c13ff5aa91f1ad6e596e66c2986ba3005e844"],
	["GgfEkEJtxZR7gnpy", "Freya", "en-gb", "eb3cd47418349e618408c16bea7153988b3ad04b41a6033039dd474a9a4dcd23"],
	["uem82D50GRv2Dwma", "Pippa", "en-gb", "d41a8f01d6e33450f1ce062d332914da10beee99e585dab531750706f187c48a"],
	["y9bQqIDnyxwqK01t", "Elodie-Rose", "en-gb", "21eade9d83b2e66b9364e1b6cd999a3a6704c000a71f27f34e05ace5cdfd58bb"],
	["gDT1nz7Ie36ZhL-C", "Imogen", "en-gb", "1980ab3c35fa98a25b5f3b5e643fd852e14ca8a12a4a26b06aaf1abf2a8c68b1"],
	["m9MxpY6IUGXtWp76", "Lottie", "en-gb", "a906ebf17e43fded12b3d6bd077abb2df33bc86eff51c1beeb82e5d416527db3"],
	["X6NceqF285Gr04gb", "Alfie", "en-gb", "4de75497fff3030168e8aa6dca23ffeb332b1bc8c25d0bf3507ceadac953ae9c"],
	["YyKcxPG7iIgS3jsK", "Hugh", "en-gb", "3169d74b47a54d1eb15e4c243f56393abe9fe90c7e1c308ecf96ee67618b152a"],
	["zUCxzrOrugTSis03", "Edwin", "en-gb", "ff1d0735b8b45710462b1d1f846da040f970c6eb62c7c2f36dbfb8e5bde74f1e"],
	["JOW0vchyswkQUMDS", "Spencer", "en-gb", "cc9ac1107b0ffce282374a19beb7bfa95847724e6b7afbac991b4ae4277d5e6d"],
	["dME3IWyZBvmh1n1q", "Toby", "en-gb", "09ab315c7f4b72b4d71e66cb756184cedfb1f14d222d096e115bf95bfe7b29dc"],
	["Zn7g6NxLqXlJb7Qi", "Teddy", "en-gb", "baea0ea9506f3237a5ebfc61afb7c72dbd189c5603b199ef42fbb00dbda379e0"],
	["gfP44RlHwr2kEwk7", "Bryony", "en-gb", "bcc207a73b7885e45b49ab633d3377a10158292e3a7cef9cd6764ad107f1cb9b"],
	["xPDpsV3F592srkjA", "Captain Silas Blackwater", "en", "a09f615b0084980ebc4076d71550bf73ccd8d4df076bbbee4a9beb523a1379d9"],
	["nOykTmcH9ydsGGIc", "Morwenna of the Deep", "en", "2ff2db91e70648623df8d42c0dcd7c336b2f14cb4362d602a20f292a4d862154"],
	["lX3LavMNdlIbgEHH", "Old Mortlake", "en", "d3f9429205e5906dcd3c78edaf7c9d5148c7e389e34c82c86f72f154adb5d923"],
	["dGyGDKo2osj7h3s7", "Azgorath", "en", "83900e020c14946426614c6553c5a138ba6277e1aaa69832223bd0f0f8b73893"],
	["cXoIXJ2llS8S0WOW", "Fennick the Young Elf", "en", "a05944e4c69d61d10d66f689175ba0b081930df2d77b22f04d00ac40d3d69ecb"],
	["GXaSqMEmOg12OIYb", "The Thing Under the Stairs", "en", "bfa37bac98aefbb9de80f792c47d01a0f9e3b94e73776169040c249c8b722759"],
	["xO8xQo3BrB8FuI6J", "Vyrmathrax the Ancient", "en", "63ab4b15427844a804480a1603774262e8903dee33cb279e2749860dbfaedd10"],
	["cYtsRSxV5q9IMehn", "Grub the Ogre", "en", "b30fa847686ec1eb6be8c5bea4b6a5c5076ea66c3ff053cf98210a155d8aad1e"],
	["gSgG5Tor0GPEnqzC", "Master Aldric", "en", "a83430cc022b85c83753f859f9e44f406651646dab994fced8ef7a9a88005971"],
	["NIWoEurJHMJjyUTe", "The Snow Queen", "en", "bc8a8fcb95bb4f32d2d4376aa69d81b186b3ba2f8e9b6cb6a403b2b194590e85"],
	["y2eiKxtQo2B67deU", "Sir Bramwell", "en", "b3cea6789aeb58822af16ba08c4e5105d7febb840dcb67b47f426c19d1a8f209"],
	["QXNr0SvkukLB4wPq", "Fairy Godmother", "en", "f390c09f5e279c0f2171995a534b92f5ca5c83443906879da68fc27445f89d89"],
];

/** Easton, the voice the model card's examples use. */
export const PHONON_DEFAULT_VOICE = "LMDIYE0Oa377Qh6Z";

export const phononVoicePath = (id: string) => `voices/${id}.safetensors`;
