__import__('pysqlite3')
import sys
sys.modules['sqlite3'] = sys.modules.pop('pysqlite3')

import chromadb
client = chromadb.PersistentClient(path="/home/messias/lyly-bot/db_final")
print(f"Coleções: {client.list_collections()}")


