#!/usr/bin/env python3
"""
Database initialization script for Dictation App
Run this to create database tables locally or verify connection
"""

import os
import sys

# Add current directory to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app import app, db, User, create_database

def main():
    """Initialize database and verify connection"""
    print("=" * 50)
    print("Dictation App - Database Initialization")
    print("=" * 50)

    # Check database URI
    db_uri = app.config.get('SQLALCHEMY_DATABASE_URI', 'Not set')
    print(f"\nDatabase URI: {db_uri}")

    try:
        # Test connection
        with app.app_context():
            # Try to connect and execute a simple query
            result = db.session.execute(db.text("SELECT 1"))
            print("✓ Database connection successful!")

            # Check existing tables
            inspector = db.inspect(db.engine)
            tables = inspector.get_table_names()
            print(f"✓ Existing tables: {tables}")

            # Create tables
            if 'user' not in tables:
                print("\nCreating database tables...")
                db.create_all()
                print("✓ Tables created successfully!")
            else:
                print("\n✓ User table already exists")

            # Show user table structure
            print("\nUser table columns:")
            for column in inspector.get_columns('user'):
                print(f"  - {column['name']}: {column['type']}")

            # Count users
            user_count = User.query.count()
            print(f"\nTotal users in database: {user_count}")

        print("\n" + "=" * 50)
        print("Database initialization complete!")
        print("=" * 50)

    except Exception as e:
        print(f"\n✗ Error: {e}")
        print("\nPlease check:")
        print("1. DATABASE_URL is set correctly in .env")
        print("2. Render PostgreSQL service is running")
        return 1

    return 0

if __name__ == '__main__':
    sys.exit(main())
