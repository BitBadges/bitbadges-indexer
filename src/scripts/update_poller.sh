#!/bin/bash


# Function to update bitbadges-indexer service
update_bitbadges_indexer() {
    sudo systemctl stop bitbadges-poller
    git config --global --add safe.directory /home/trevormil/bitbadges-indexer
    git stash
    git pull
    npm install
    npm run build
    sudo systemctl restart bitbadges-poller
}

# Main function
main() {
    echo "Updating bitbadges-indexer service..."
    update_bitbadges_indexer $1
    echo "bitbadges-indexer service updated successfully."
}

# Run the main function
main $1
