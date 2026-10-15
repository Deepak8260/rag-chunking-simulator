/* Sample documents for Chunk Lab. Each one shows off different strategies. */
window.SAMPLES = {
  markdown: {
    label: "Markdown handbook (headings, lists, code, table)",
    text: `# Retrieval-Augmented Generation Handbook

## What is RAG?

Retrieval-Augmented Generation (RAG) combines a search system with a large language model. Instead of relying only on what the model memorised during training, the application retrieves relevant passages from a knowledge base and adds them to the prompt. The model then answers using that fresh, citable context.

RAG reduces hallucinations, keeps answers up to date without retraining, and lets you point to the exact source of every claim.

## Ingestion pipeline

### Loading

Documents arrive as PDFs, web pages, Markdown files, spreadsheets and support tickets. A loader extracts plain text and keeps useful metadata such as the title, author, URL and last-modified date.

### Chunking

Chunking splits each document into smaller passages before embedding. Chunks that are too large dilute the meaning of the embedding and waste context window. Chunks that are too small lose the surrounding context needed to answer a question.

Good chunking strategies usually:

- respect natural boundaries such as sentences, paragraphs and sections
- keep code blocks and tables intact
- add a small overlap so ideas that span a boundary are not lost
- attach metadata like the section heading to every chunk

### Embedding

Each chunk is converted into a dense vector by an embedding model. Similar meanings end up close together in vector space.

\`\`\`python
from sentence_transformers import SentenceTransformer

model = SentenceTransformer("all-MiniLM-L6-v2")
vectors = model.encode(chunks, normalize_embeddings=True)
\`\`\`

## Comparing vector databases

| Database | Hosting | Hybrid search | Free tier |
|----------|---------|---------------|-----------|
| pgvector | Self-hosted / managed Postgres | Yes, with full-text | Yes |
| Qdrant | Self-hosted / cloud | Yes | Yes |
| Pinecone | Managed cloud | Yes | Yes |
| Chroma | Embedded / self-hosted | Limited | Open source |

## Retrieval and generation

At query time the user's question is embedded with the same model. The vector database returns the top-k most similar chunks, optionally re-ranked by a cross-encoder. The chunks are inserted into the prompt together with instructions to answer only from the provided context and to cite sources.

## Evaluation

Measure retrieval quality with recall@k and mean reciprocal rank on a labelled set of questions. Measure answer quality with faithfulness and answer relevance. Small changes to chunk size and overlap often move these metrics more than switching the embedding model.
`,
  },
  prose: {
    label: "Plain prose with topic shifts (try Semantic)",
    text: `Coffee was first cultivated in the highlands of Ethiopia and later in Yemen, where Sufi monks drank it to stay awake during night prayers. By the sixteenth century coffee houses had spread across Cairo, Istanbul and Damascus. These coffee houses became lively centres of conversation, music and chess. European traders brought the beans to Venice and London, and coffee quickly rivalled tea and beer as a daily drink. Today coffee is grown in more than fifty countries along the tropical belt, with Brazil producing the largest harvest.

Volcanoes form where molten rock, called magma, rises through the Earth's crust. Most volcanoes sit along the boundaries of tectonic plates, especially around the Pacific Ring of Fire. When pressure from dissolved gases builds up, the magma can erupt explosively and hurl ash high into the atmosphere. Other volcanoes, like those in Hawaii, produce gentle lava flows that slowly build broad shield-shaped mountains. Volcanic ash enriches the soil, which is why farms often thrive on the slopes of dormant volcanoes.

Honeybees live in colonies of tens of thousands of workers, a few hundred drones and a single queen. Worker bees communicate the location of flowers through the waggle dance, encoding direction and distance in their movements. The colony stores nectar as honey, evaporating water from it by fanning their wings inside the hive. Bees pollinate roughly a third of the crops humans eat, including apples, almonds and blueberries. Habitat loss, pesticides and parasitic mites have caused worrying declines in bee populations.

Modern spacecraft rely on ion thrusters for long missions because they use fuel very efficiently. An ion thruster accelerates charged xenon atoms through an electric field and expels them at enormous speed. The thrust is tiny, about the weight of a sheet of paper, yet it never stops pushing for months or years. Missions such as Dawn used ion propulsion to orbit two different bodies in the asteroid belt. Engineers expect future crewed missions to Mars to combine chemical rockets with electric propulsion.`,
  },
  code: {
    label: "Python source code (try Recursive → Python)",
    text: `"""Tiny vector store used in the RAG workshop."""
import math
from dataclasses import dataclass, field


@dataclass
class Document:
    id: str
    text: str
    metadata: dict = field(default_factory=dict)


def cosine(a, b):
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    return dot / (na * nb) if na and nb else 0.0


class VectorStore:
    """Keeps embeddings in memory and answers top-k similarity queries."""

    def __init__(self, embed_fn):
        self.embed_fn = embed_fn
        self.docs = []
        self.vectors = []

    def add(self, doc: Document):
        self.docs.append(doc)
        self.vectors.append(self.embed_fn(doc.text))

    def search(self, query: str, k: int = 3):
        q = self.embed_fn(query)
        scored = [(cosine(q, v), d) for v, d in zip(self.vectors, self.docs)]
        scored.sort(key=lambda pair: pair[0], reverse=True)
        return scored[:k]


def chunk_text(text, size=500, overlap=50):
    """Naive fixed-size chunker with overlap."""
    chunks = []
    start = 0
    while start < len(text):
        end = min(start + size, len(text))
        chunks.append(text[start:end])
        if end == len(text):
            break
        start = end - overlap
    return chunks


if __name__ == "__main__":
    store = VectorStore(embed_fn=lambda t: [t.count(c) for c in "aeiou"])
    for i, piece in enumerate(chunk_text(open("handbook.md").read())):
        store.add(Document(id=str(i), text=piece))
    for score, doc in store.search("how do I chunk documents?"):
        print(f"{score:.3f}", doc.id, doc.text[:60])
`,
  },
};
