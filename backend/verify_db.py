from db import get_db_connection
from pgvector.psycopg2 import register_vector

def verify():
    conn = get_db_connection()
    register_vector(conn)
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT count(*) FROM code_chunks;")
            total_chunks = cur.fetchone()[0]
            
            cur.execute("SELECT count(DISTINCT file_path) FROM code_chunks;")
            total_files = cur.fetchone()[0]
            
            print(f"Total chunks stored: {total_chunks}")
            print(f"Total distinct files: {total_files}")
            
            print("\nSample 5 chunks:")
            cur.execute("""
                SELECT id, file_path, chunk_index, length(content) as content_len, 
                       embedding IS NOT NULL as has_embedding
                FROM code_chunks 
                ORDER BY id ASC 
                LIMIT 5;
            """)
            rows = cur.fetchall()
            for r in rows:
                print(f"  ID: {r[0]} | File: {r[1]} | Chunk: {r[2]} | Chars: {r[3]} | HasEmbedding: {r[4]}")
                
            print("\nDistinct file sample (up to 10):")
            cur.execute("SELECT DISTINCT file_path FROM code_chunks LIMIT 10;")
            files = cur.fetchall()
            for f in files:
                print(f"  - {f[0]}")
    finally:
        conn.close()

if __name__ == "__main__":
    verify()
