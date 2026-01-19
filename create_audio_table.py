#!/usr/bin/env python3
"""Create the AudioFile table in the existing database"""

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app import app, db, AudioFile

def create_audio_table():
    """Create the AudioFile table"""
    with app.app_context():
        # Create just the AudioFile table
        db.create_all()

        # Check if table exists
        from sqlalchemy import inspect
        inspector = inspect(db.engine)
        tables = inspector.get_table_names()

        if 'audio_file' in tables:
            print("AudioFile table created successfully!")
        else:
            # Try creating with raw SQL as fallback
            print("Attempting to create table with raw SQL...")
            db.session.execute(db.text("""
                CREATE TABLE IF NOT EXISTS audio_file (
                    id SERIAL PRIMARY KEY,
                    text_hash VARCHAR(64) UNIQUE NOT NULL,
                    text_content TEXT NOT NULL,
                    audio_data BYTEA NOT NULL,
                    audio_format VARCHAR(10) NOT NULL DEFAULT 'mp3',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """))
            db.session.commit()
            print("AudioFile table created with raw SQL!")

        # Verify
        count = AudioFile.query.count()
        print(f"AudioFile table exists with {count} records")

if __name__ == '__main__':
    create_audio_table()
