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
    rm /etc/nginx/ssl/server.cert
    rm /etc/nginx/ssl/server.key
    cp ./server.cert /etc/nginx/ssl/
    cp ./server.key /etc/nginx/ssl/
    git reset --hard
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
    echo "Updating bitbadges-indexer service..."
    update_bitbadges_indexer $1
    echo "bitbadges-indexer service updated successfully."


    echo "Updating Nginx..."
    update_nginx
    echo "Nginx updated successfully."
}

# Run the main function
main $1
