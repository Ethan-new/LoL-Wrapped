# frozen_string_literal: true

class AddRankEntriesToPlayers < ActiveRecord::Migration[7.2]
  def change
    add_column :players, :rank_entries, :jsonb, default: []
  end
end
