# frozen_string_literal: true

class AddTeammateRiotIdToRecapPeople < ActiveRecord::Migration[7.2]
  def change
    add_column :recap_people, :teammate_riot_id, :string
  end
end
