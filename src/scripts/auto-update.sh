#!/bin/bash

# Function to update Nginx
update_nginx() {
    sudo apt update
    sudo apt upgrade -y nginx
    sudo systemctl restart nginx
}

# Function to update bitbadges-indexer service
update_bitbadges_indexer() {
    sudo systemctl stop bitbadges-indexer
    cd /root/bitbadges-indexer
    rm ./server.cert
    rm ./server.key
    cp /etc/nginx/ssl/server.cert ./
    cp /etc/nginx/ssl/server.key ./
    git pull
    npm install
    npm run build
    #if --delete flag, run the setup script
    if [ "$1" == "--delete" ]; then
        read -p "Are you sure you want to delete existing data? This action cannot be undone. (yes/no): " confirm_delete
        if [ "$confirm_delete" == "yes" ]; then
            npm run setup with-delete
        else
            echo "Operation aborted."
            exit 1
        fi
    fi

    sudo systemctl start bitbadges-indexer
}

# Main function
main() {
    echo "Updating Nginx..."
    update_nginx
    echo "Nginx updated successfully."

    echo "Updating bitbadges-indexer service..."
    update_bitbadges_indexer $1
    echo "bitbadges-indexer service updated successfully."
}

# Run the main function
main $1
