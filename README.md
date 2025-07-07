# Hosts-Capacity
This script take named Netbox host groups in Zabbix, check and create aggregate hosts with name mask capacity.{$GROUPNAME} and with template Capacity. Template Capacity take RAM, CPU, and disk aggregate metrics from all platforms via zabbix host groups and calculate them.

CPU - avg, max, total
RAM- avg, max, total
Disk - avg, max, total
