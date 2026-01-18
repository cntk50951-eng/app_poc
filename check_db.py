#!/usr/bin/env python3
"""Check database contents"""

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app import app, db, User

def main():
    with app.app_context():
        print("=" * 50)
        print("Database Check")
        print("=" * 50)

        # Check users
        users = User.query.all()
        print(f"\nTotal users: {len(users)}")
        for user in users:
            print(f"\nUser ID: {user.id}")
            print(f"  Email: {user.email}")
            print(f"  Name: {user.name}")
            print(f"  Google ID: {user.google_id}")
            print(f"  Avatar: {user.avatar_url}")
            print(f"  Created at: {user.created_at}")

if __name__ == '__main__':
    main()
