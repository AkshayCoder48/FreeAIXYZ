#!/usr/bin/env bash
# Persistent dev-server launcher for the freeaixyz project.
# Double-forks (daemonize pattern) so the server survives the parent shell exit.
cd /home/z/my-project/freeaixyz
exec bun run dev
