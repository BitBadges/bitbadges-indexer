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

    rm /etc/nginx/ssl/server.cert
    rm /etc/nginx/ssl/server.key
    cp ./server.cert /etc/nginx/ssl/
    cp ./server.key /etc/nginx/ssl/
    sudo apt update
    sudo apt upgrade -y nginx
    sudo systemctl restart nginx
}

# Main function
main() {
    echo "Updating bitbadges-indexer service..."
    update_bitbadges_indexer $1
    echo "bitbadges-indexer service updated successfully."
}

# Run the main function
main $1
