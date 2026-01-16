# Twake Calendar Stack -- Local Setup Guide

This guide explains how to start the Twake Calendar stack locally in the
correct order.

------------------------------------------------------------------------

## Prerequisites

-   Docker
-   Docker Compose
-   Linux
-   Ports 80 / 443 available

------------------------------------------------------------------------

## Step 1: Start Databases

Navigate to the database directory and start the services:

``` bash
cd twake_db
docker-compose up -d
cd ..
```

------------------------------------------------------------------------

## Step 2: Start Authentication & Proxy Layer

``` bash
cd twake_auth
docker-compose up -d
cd ..
```

------------------------------------------------------------------------

## Step 3: Configure /etc/hosts

The stack uses `*.twake.local` domains.

Edit your `/etc/hosts` file:

``` bash
sudo nano /etc/hosts
```

Add the following entries:

``` text
127.0.0.1  tcalendar-side-service.twake.local sabre-dav.twake.local
127.0.0.1  calendar.twake.local contacts.twake.local account.twake.local excal.twake.local
```

Save and exit.

------------------------------------------------------------------------

## Step 4: Start Calendar Application

``` bash
cd TCalendar_app
docker compose up -d
```

------------------------------------------------------------------------

## Step 5: Import Root CA Certificate (IMPORTANT)

The side service requires trusting the custom Root CA.

Enter the container:

``` bash
docker exec -it tcalendar-side-service.twake.local bash
```

Run the following command **inside the container**:

``` bash
keytool -importcert -trustcacerts   -keystore $JAVA_HOME/lib/security/cacerts   -storepass changeit   -alias twake-root-ca   -file /usr/local/share/ca-certificates/root-ca.crt
```

Confirm with `yes` when prompted.

Exit the container and restart it:

``` bash
exit
docker restart tcalendar-side-service.twake.local
```

------------------------------------------------------------------------

## Done ✅

You can now access the applications:

-   Calendar: https://calendar.twake.local
-   Contacts: https://contacts.twake.local
-   Account: https://account.twake.local
-   Public calendar: https://excal.twake.local


------------------------------------------------------------------------


