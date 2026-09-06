import sys
import argparse
from retrieval import retrieve_chunks

def test_query(question: str, top_k: int = 5):
    print("\n" + "=" * 60)
    print(f"Question: {question}")
    print("=" * 60)
    
    chunks, sources = retrieve_chunks(question, top_k=top_k)
    
    if not chunks:
        print("No matching chunks found.")
        return

    print(f"\n--> Retrieved {len(chunks)} Chunks:")
    for idx, c in enumerate(chunks, 1):
        print(f"\n[{idx}] File: {c['file_path']} (Chunk #{c['chunk_index']})")
        print(f"    Cosine Similarity: {c['similarity']}")
        preview = c['content'].replace('\n', ' ')[:250]
        print(f"    Snippet Preview: {preview}...")
        
    print("\n--> Unique Source Files:")
    for s in sources:
        print(f"  - {s}")
    print("=" * 60 + "\n")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Test pgvector retrieval quality on codebase.")
    parser.add_argument("question", nargs="?", default="How does Flask handle routing and URL rules?", help="Question to query")
    parser.add_argument("--top_k", type=int, default=5, help="Number of chunks to retrieve (default: 5)")
    args = parser.parse_args()
    test_query(args.question, args.top_k)
